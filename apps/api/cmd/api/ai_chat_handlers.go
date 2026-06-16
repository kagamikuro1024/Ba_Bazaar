package main

import (
	"context"
	"log"
	"net/http"
	"time"
)

type aiChatToolCallReq struct {
	ToolName     string `json:"tool_name"`
	InputJSON    string `json:"input_json"`
	OutputJSON   string `json:"output_json"`
	Status       string `json:"status"`
	LatencyMs    int    `json:"latency_ms"`
	ErrorMessage string `json:"error_message"`
}

type aiChatLogReq struct {
	SessionID        string              `json:"session_id"`
	FeatureName      string              `json:"feature_name"` // AI_PMPO_CHATBOT or AI_BAMGR_CHATBOT
	UserMessage      string              `json:"user_message"`
	AssistantMessage string              `json:"assistant_message"`
	Status           string              `json:"status"` // SUCCESS or FAILED
	DurationMs       int                 `json:"duration_ms"`
	TokenInput       int                 `json:"token_input"`
	TokenOutput      int                 `json:"token_output"`
	ModelName        string              `json:"model_name"`
	PromptVersion    string              `json:"prompt_version"`
	ToolCalls        []aiChatToolCallReq `json:"tool_calls"`
	Error            *string             `json:"error"`
}

func (app *App) handleAIChatLog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Authenticate the user (or fall back to role/id from headers if mock auth is used)
	user, _ := app.currentUser(r)
	var userID *string
	var role string = "BA_MANAGER"
	if user != nil {
		userID = &user.ID
		role = user.Role
	} else {
		// Try to read mock headers if present
		if mockRole := r.Header.Get("X-Mock-Role"); mockRole != "" {
			role = roleAlias(mockRole)
		}
		if mockUserID := r.Header.Get("X-User-Id"); mockUserID != "" {
			userID = &mockUserID
		}
	}

	var req aiChatLogReq
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}

	if req.SessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "session_id is required"})
		return
	}

	if req.FeatureName == "" {
		req.FeatureName = "AI_PMPO_CHATBOT"
	}

	// If AI Observability is disabled globally, just return OK
	if !app.isAIFeatureEnabled(ctx, "ai_observability_enabled") {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "observability disabled"})
		return
	}

	// Cost formula: $0.14 per 1M input, $0.28 per 1M output
	cost := float64(req.TokenInput)*0.00000014 + float64(req.TokenOutput)*0.00000028

	// Database operations are run inside a goroutine to not block the chat server response,
	// but we log any DB errors to standard output/log.
	go func() {
		bg := context.Background()
		
		// 1. Create or update the session
		now := time.Now()
		startedAt := now.Add(-time.Duration(req.DurationMs) * time.Millisecond)

		_, err := app.DB.Pool.Exec(bg, `
			insert into ai_sessions (
				id, user_id, user_role, feature_name, status, started_at, ended_at, 
				duration_ms, token_input, token_output, estimated_cost, error_count,
				model_name, prompt_version
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13)
			on conflict (id) do update set
				status = $5,
				ended_at = $7,
				duration_ms = coalesce(ai_sessions.duration_ms, 0) + $8,
				token_input = coalesce(ai_sessions.token_input, 0) + $9,
				token_output = coalesce(ai_sessions.token_output, 0) + $10,
				estimated_cost = coalesce(ai_sessions.estimated_cost, 0) + $11,
				model_name = coalesce(ai_sessions.model_name, $12),
				prompt_version = coalesce(ai_sessions.prompt_version, $13)
		`, req.SessionID, userID, role, req.FeatureName, req.Status, startedAt, now, req.DurationMs, req.TokenInput, req.TokenOutput, cost, nullIfEmptyString(req.ModelName), nullIfEmptyString(req.PromptVersion))
		if err != nil {
			log.Printf("failed to insert/update ai_session: %v", err)
			return
		}

		// 2. Insert User Message
		if req.UserMessage != "" {
			sanitizedUser := maskSensitive(req.UserMessage)
			_, _ = app.DB.Pool.Exec(bg, `
				insert into ai_messages (id, session_id, sender, content, sanitized_content, created_at)
				values ($1, $2, 'USER', $3, $4, now())
			`, newUUID(), req.SessionID, req.UserMessage, sanitizedUser)
		}

		// 3. Insert Assistant Message
		if req.AssistantMessage != "" {
			sanitizedAssistant := maskSensitive(req.AssistantMessage)
			_, _ = app.DB.Pool.Exec(bg, `
				insert into ai_messages (id, session_id, sender, content, sanitized_content, created_at)
				values ($1, $2, 'ASSISTANT', $3, $4, now())
			`, newUUID(), req.SessionID, req.AssistantMessage, sanitizedAssistant)
		}

		// 4. Insert Tool Calls
		for _, tc := range req.ToolCalls {
			toolCallID := newUUID()
			_, _ = app.DB.Pool.Exec(bg, `
				insert into ai_tool_calls (id, session_id, tool_name, feature_name, input_json, output_json, status, latency_ms, error_message, created_at)
				values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, now())
			`, toolCallID, req.SessionID, tc.ToolName, req.FeatureName, tc.InputJSON, tc.OutputJSON, tc.Status, tc.LatencyMs, tc.ErrorMessage)

			if tc.Status == "FAILED" {
				_, _ = app.DB.Pool.Exec(bg, `update ai_sessions set error_count = error_count + 1 where id = $1`, req.SessionID)
				_ = app.writeAIError(bg, req.SessionID, req.FeatureName, "TOOL_CALL_FAILED", "HIGH", "Tool call failed: "+tc.ToolName, tc.ErrorMessage)
			}
		}

		// 5. Insert Error if any
		if req.Error != nil && *req.Error != "" {
			_, _ = app.DB.Pool.Exec(bg, `update ai_sessions set error_count = error_count + 1 where id = $1`, req.SessionID)
			_ = app.writeAIError(bg, req.SessionID, req.FeatureName, "UNKNOWN", "HIGH", *req.Error, "")
		}
	}()

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
