package main

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type aiSession struct {
	app     *App
	id      string
	feature string
	role    string
	userID  *string
	start   time.Time
}

var (
	emailRegex         = regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
	phoneRegex         = regexp.MustCompile(`\b\d{9,11}\b`)
	sensitiveKeysRegex = regexp.MustCompile(`(?i)(password|token|secret|api[_-]?key|authorization|bearer|password_hash)\s*[:=]\s*["']?([a-zA-Z0-9_\-\.\~]+)["']?`)
)

// maskSensitive redacts passwords, tokens, email addresses, and phone numbers in logged messages.
func maskSensitive(text string) string {
	text = sensitiveKeysRegex.ReplaceAllString(text, `$1: "[REDACTED]"`)
	text = emailRegex.ReplaceAllString(text, "[EMAIL_REDACTED]")
	text = phoneRegex.ReplaceAllString(text, "[PHONE_REDACTED]")
	return text
}

func nullIfEmptyString(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

// beginAISession starts tracking an AI request session.
func (app *App) beginAISession(ctx context.Context, userID *string, role, feature, entryPoint, model, promptVer string) *aiSession {
	id := newUUID()
	session := &aiSession{
		app:     app,
		id:      id,
		feature: feature,
		role:    role,
		userID:  userID,
		start:   time.Now(),
	}

	if !app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		return session
	}

	go func() {
		bg := context.Background()
		_, _ = app.DB.Pool.Exec(bg, `
			insert into ai_sessions (id, user_id, user_role, feature_name, entry_point, status, model_name, prompt_version, started_at)
			values ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8)
		`, id, userID, role, feature, nullIfEmptyString(entryPoint), nullIfEmptyString(model), nullIfEmptyString(promptVer), session.start)
	}()

	return session
}

// logMessage saves a chat turn.
func (s *aiSession) logMessage(ctx context.Context, sender, content string) {
	if !s.app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		return
	}
	sanitized := maskSensitive(content)
	go func() {
		bg := context.Background()
		_, _ = s.app.DB.Pool.Exec(bg, `
			insert into ai_messages (id, session_id, sender, content, sanitized_content, created_at)
			values ($1, $2, $3, $4, $5, now())
		`, newUUID(), s.id, sender, content, sanitized)
	}()
}

// logExtraction tracks entity extraction outcomes (e.g. from PRD).
func (s *aiSession) logExtraction(ctx context.Context, typ, rawInput string, extracted any, missing []string, conf float64) {
	if !s.app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		return
	}

	extractedJSON, _ := json.Marshal(extracted)
	var missingJSON []byte
	if len(missing) > 0 {
		missingJSON, _ = json.Marshal(missing)
	}

	go func() {
		bg := context.Background()
		_, _ = s.app.DB.Pool.Exec(bg, `
			insert into ai_extractions (id, session_id, extraction_type, raw_input, extracted_json, missing_fields, confidence, created_at)
			values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, now())
		`, newUUID(), s.id, typ, rawInput, extractedJSON, missingJSON, conf)
	}()
}

// logToolCall times and audits helper tools used during the LLM execution.
func (s *aiSession) logToolCall(ctx context.Context, tool string, input any, run func() (any, error)) (any, error) {
	start := time.Now()
	res, err := run()
	duration := time.Since(start).Milliseconds()

	if !s.app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		return res, err
	}

	inputJSON, _ := json.Marshal(input)
	var outputJSON []byte
	var errMsg *string
	status := "SUCCESS"
	if err != nil {
		status = "FAILED"
		msg := err.Error()
		errMsg = &msg
	} else if res != nil {
		outputJSON, _ = json.Marshal(res)
	}

	toolCallID := newUUID()
	go func() {
		bg := context.Background()
		_, _ = s.app.DB.Pool.Exec(bg, `
			insert into ai_tool_calls (id, session_id, tool_name, feature_name, input_json, output_json, status, latency_ms, error_message, created_at)
			values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, now())
		`, toolCallID, s.id, tool, s.feature, inputJSON, outputJSON, status, duration, errMsg)

		if err != nil {
			_, _ = s.app.DB.Pool.Exec(bg, `update ai_sessions set error_count = error_count + 1 where id = $1`, s.id)
			_ = s.app.writeAIError(bg, s.id, s.feature, "TOOL_CALL_FAILED", "HIGH", "Tool call failed: "+tool, err.Error())
		}
	}()

	return res, err
}

// logError records structural issues like timeout or LLM failure.
func (s *aiSession) logError(ctx context.Context, errType, severity, msg string, err error) {
	if !s.app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		return
	}
	go func() {
		bg := context.Background()
		_, _ = s.app.DB.Pool.Exec(bg, `update ai_sessions set error_count = error_count + 1 where id = $1`, s.id)
		stack := ""
		if err != nil {
			stack = fmt.Sprintf("%+v", err)
		}
		_ = s.app.writeAIError(bg, s.id, s.feature, errType, severity, msg, stack)
	}()
}

func (app *App) writeAIError(ctx context.Context, sessionID string, feature, errType, severity, msg, stack string) error {
	var sessID *string
	if sessionID != "" {
		sessID = &sessionID
	}
	_, err := app.DB.Pool.Exec(ctx, `
		insert into ai_errors (id, session_id, feature_name, error_type, severity, message, stack_trace, status, created_at)
		values ($1, $2, $3, $4, $5, $6, $7, 'OPEN', now())
	`, newUUID(), sessID, feature, errType, severity, msg, nullIfEmptyString(stack))
	return err
}

// finish ends tracking the AI session and registers costs.
func (s *aiSession) finish(ctx context.Context, status string, createdRequestID *string, tokIn, tokOut int) {
	if !s.app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		return
	}
	duration := time.Since(s.start).Milliseconds()

	// Estimated cost formula based on DeepSeek API pricing ($0.14/1M Input, $0.28/1M Output)
	cost := float64(tokIn)*0.00000014 + float64(tokOut)*0.00000028

	go func() {
		bg := context.Background()
		_, _ = s.app.DB.Pool.Exec(bg, `
			update ai_sessions
			set status = $1, ended_at = now(), duration_ms = $2, created_request_id = $3, token_input = $4, token_output = $5, estimated_cost = $6
			where id = $7
		`, status, duration, createdRequestID, tokIn, tokOut, cost, s.id)
	}()
}
