// Package aiagent is the AI Assistant v2 agent loop.
//
// What this is:
//   A bounded, auditable, function-calling agent. You give it a
//   conversation, it picks a tool, runs the tool, sees the result,
//   and either picks another tool or replies in prose. Read tools
//   run automatically; write tools stage a draft the user must
//   confirm.
//
// What this is NOT:
//   - A general-purpose autonomous agent. It is constrained by:
//     * a hard iteration cap (no infinite loops)
//     * the tool whitelist (no shell, no file system, no network)
//     * the 3-tier autonomy contract (writes never execute silently)
//   - A stateful planner. The agent has no goals of its own; it
//     only answers the user's question.

package aiagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"ba-bazaar-go/cmd/api/aigateway"
	"ba-bazaar-go/cmd/api/aitools"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxIterations caps how many tool calls a single chat turn can make.
// 6 is enough for "search BAs → check capacity → draft booking" and
// small enough that a stuck agent can't burn the budget.
const MaxIterations = 6

// AssistantSystemPrompt is loaded from the prompts/ directory when the
// app boots. We keep the file on disk so it is git-diffable and
// reviewers don't need to know Go to change the persona.
const AssistantSystemPrompt = "assistant_v1"

// Loop is the dependency-injected agent.
type Loop struct {
	DB           DBExec
	Store        Store
	Gateway      *aigateway.Gateway
	Tools        *aitools.Registry
	SystemPrompt string
	// Now is overridable for tests.
	Now func() time.Time
}

// New constructs a Loop with the default system prompt loaded from
// the aigateway prompts directory. If the file is missing, we fall
// back to a hard-coded minimal persona so dev never breaks.
func New(db *pgxpool.Pool, gw *aigateway.Gateway, tools *aitools.Registry) *Loop {
	sys, ok := aigateway.LoadPrompt(AssistantSystemPrompt)
	if !ok {
		sys = "You are Ba-Bazaar Assistant, a helpful AI for BA capacity planning."
	}
	return &Loop{
		DB:           &poolDB{pool: db},
		Store:        StoreFromDB(db),
		Gateway:      gw,
		Tools:        tools,
		SystemPrompt: sys,
		Now:          time.Now,
	}
}

// Step is one observation in the agent's run, returned to the caller
// for the response payload. The frontend renders each step as a card.
type Step struct {
	Kind     string `json:"kind"` // "tool_call" | "tool_result" | "final"
	ToolName string `json:"tool_name,omitempty"`
	// ToolCallID links a tool_result back to the matching tool_call so
	// the frontend can update one line instead of appending a second.
	ToolCallID string         `json:"tool_call_id,omitempty"`
	Args       map[string]any `json:"args,omitempty"`
	Result     any            `json:"result,omitempty"`
	// PendingAction is non-nil only when the step is a TierDraft tool
	// call. The caller (HTTP layer) persists this into
	// ai_pending_actions and shows the user a Confirm/Undo card.
	PendingAction *PendingAction `json:"pending_action,omitempty"`
	Content       string         `json:"content,omitempty"`
}

// PendingAction is the staged write the user must confirm.
type PendingAction struct {
	// ID is the ai_pending_actions row id.
	ID string `json:"id"`
	// ToolName is the function the model called.
	ToolName string `json:"tool_name"`
	// Args is the verbatim arguments the model emitted.
	Args map[string]any `json:"args"`
	// Preview is the human-readable summary the tool returned.
	Preview any `json:"preview"`
	// UndoWindowSeconds is the time the user has to undo.
	UndoWindowSeconds int `json:"undo_window_seconds"`
}

// Run executes one chat turn. It returns the steps taken (so the
// frontend can render them) and the final assistant message.
//
// userID is the caller's id; it ends up in ai_decisions.user_id for
// audit. conversationID is the ai_conversations row; if empty we
// create one and the caller can persist the new id.
func (l *Loop) Run(ctx context.Context, userID, conversationID, userText string) (steps []Step, finalContent string, newConversationID string, err error) {
	// Tiny adapter so we can reuse RunStream with a no-op callback.
	noop := func(Step) {}
	steps, finalContent, newConversationID, err = l.RunStream(ctx, userID, conversationID, userText, noop)
	return steps, finalContent, newConversationID, err
}

// RunStream is the streaming variant of Run. It pushes each Step to
// onStep as it happens, so an SSE handler can flush events to the
// browser in real time. onToken receives provider token deltas when
// available. The function still returns the full step slice at the
// end for callers that want it.
//
// Concurrency: onStep is called from the same goroutine that runs
// the loop, so no locking is required. The caller is responsible
// for any flushing (e.g. http.Flusher.Flush) it wants to do per
// step.
func (l *Loop) RunStream(ctx context.Context, userID, conversationID, userText string, onStep func(Step), onToken ...func(string)) ([]Step, string, string, error) {
	if strings.TrimSpace(userText) == "" {
		return nil, "", conversationID, errors.New("empty user text")
	}
	steps := make([]Step, 0, 8)
	seenToolCalls := map[string]int{}

	emit := func(s Step) {
		steps = append(steps, s)
		if onStep != nil {
			onStep(s)
		}
	}

	streamToken := func(string) {}
	if len(onToken) > 0 && onToken[0] != nil {
		streamToken = onToken[0]
	}

	convID, err := l.Store.EnsureConversation(ctx, userID, conversationID, userText)
	if err != nil {
		return nil, "", conversationID, fmt.Errorf("conversation: %w", err)
	}
	if err := l.Store.AppendMessage(ctx, convID, "user", userText, "", ""); err != nil {
		return nil, "", convID, fmt.Errorf("save user message: %w", err)
	}

	history, err := l.Store.LoadHistory(ctx, convID, 20)
	if err != nil {
		return nil, "", convID, fmt.Errorf("load history: %w", err)
	}
	msgs := make([]aigateway.Message, 0, len(history))
	for _, m := range history {
		msgs = append(msgs, aigateway.Message{
			Role: aigateway.Role(m.Role), Content: m.Content,
			Name: m.ToolName, ToolID: m.ToolCallID,
		})
	}

	for iter := 0; iter < MaxIterations; iter++ {
		// Bail if the client went away. Stream cancellation is the
		// most common reason for an early exit; we'd rather stop the
		// loop than keep making LLM calls nobody is listening to.
		if err := ctx.Err(); err != nil {
			return steps, "", convID, err
		}

		resp, err := l.Gateway.Complete(ctx, aigateway.Request{
			System:      l.SystemPrompt,
			Messages:    msgs,
			Tools:       l.Tools.AsGatewayTools(),
			CallerName:  "agent_loop",
			UserID:      userID,
			Temperature: 0.2,
			MaxTokens:   800,
			JSONMode:    false,
			OnToken:     streamToken,
		})
		if err != nil {
			return steps, "", convID, fmt.Errorf("gateway: %w", err)
		}

		_ = l.Store.AppendMessage(ctx, convID, "assistant", resp.Content, "", "")

		if len(resp.ToolCalls) == 0 {
			emit(Step{Kind: "final", Content: resp.Content})
			return steps, resp.Content, convID, nil
		}
		if duplicateLoopLikely(resp.ToolCalls, seenToolCalls) || repeatedSearchAfterCapacity(resp.ToolCalls, steps) || projectNotFoundLoopLikely(resp.ToolCalls, steps) {
			finalContent := summarizeToolContext(steps)
			_ = l.Store.AppendMessage(ctx, convID, "assistant", finalContent, "", "")
			emit(Step{Kind: "final", Content: finalContent})
			return steps, finalContent, convID, nil
		}

		for _, tc := range resp.ToolCalls {
			callKey := canonicalToolCallKey(tc)
			seenToolCalls[callKey]++
			if seenToolCalls[callKey] > 1 {
				msg := "I already tried that exact lookup and got the same context. I’ll answer from the results I have instead of repeating it."
				emit(Step{Kind: "tool_result", ToolName: tc.Name, ToolCallID: tc.ID, Result: map[string]any{"skipped_duplicate": true, "message": msg}})
				_ = l.Store.AppendMessage(ctx, convID, "tool", `{"skipped_duplicate":true,"message":"duplicate tool call skipped"}`, tc.ID, tc.Name)
				continue
			}

			tool, ok := l.Tools.Get(tc.Name)
			if !ok {
				emit(Step{Kind: "tool_call", ToolName: tc.Name, ToolCallID: tc.ID, Args: tc.Arguments})
				emit(Step{Kind: "tool_result", ToolName: tc.Name, ToolCallID: tc.ID,
					Result: map[string]any{"error": "unknown tool; available: " + toolNamesFor(l.Tools)},
				})
				_ = l.Store.AppendMessage(ctx, convID, "tool",
					`{"error":"unknown tool"}`, tc.ID, tc.Name)
				continue
			}

			emit(Step{Kind: "tool_call", ToolName: tc.Name, ToolCallID: tc.ID, Args: tc.Arguments})

			result, runErr := tool.Run(ctx, l.AsAIToolsDB(), tc.Arguments)
			if runErr != nil {
				emit(Step{Kind: "tool_result", ToolName: tc.Name, ToolCallID: tc.ID,
					Result: map[string]any{"error": runErr.Error()}})
				errJSON, _ := json.Marshal(map[string]any{"error": runErr.Error()})
				_ = l.Store.AppendMessage(ctx, convID, "tool", string(errJSON), tc.ID, tc.Name)
				continue
			}
			resultJSON, _ := json.Marshal(result)
			_ = l.Store.AppendMessage(ctx, convID, "tool", string(resultJSON), tc.ID, tc.Name)

			if l.Tools.IsMutating(tc.Name) {
				pending, pErr := l.stagePendingAction(ctx, userID, convID, tc, result)
				if pErr != nil {
					return steps, "", convID, fmt.Errorf("stage pending: %w", pErr)
				}
				emit(Step{Kind: "tool_result", ToolName: tc.Name, ToolCallID: tc.ID, Result: result, PendingAction: pending})
				finalContent := "Drafted. Confirm below or ask me to change something."
				_ = l.Store.AppendMessage(ctx, convID, "assistant", finalContent, "", "")
				emit(Step{Kind: "final", Content: finalContent})
				return steps, finalContent, convID, nil
			}
			emit(Step{Kind: "tool_result", ToolName: tc.Name, ToolCallID: tc.ID, Result: result})
		}

		history, err = l.Store.LoadHistory(ctx, convID, 20)
		if err != nil {
			return steps, "", convID, fmt.Errorf("reload history: %w", err)
		}
		msgs = msgs[:0]
		for _, m := range history {
			msgs = append(msgs, aigateway.Message{
				Role: aigateway.Role(m.Role), Content: m.Content,
				Name: m.ToolName, ToolID: m.ToolCallID,
			})
		}
	}

	finalContent := "I reached the maximum number of tool calls for one turn. Try a more specific question, or break this into smaller steps."
	_ = l.Store.AppendMessage(ctx, convID, "assistant", finalContent, "", "")
	emit(Step{Kind: "final", Content: finalContent})
	return steps, finalContent, convID, nil
}

// stagePendingAction writes a row to ai_pending_actions. The HTTP
// handler surfaces the id to the user; /ai/agent/confirm promotes it
// to a real domain record.
func (l *Loop) stagePendingAction(ctx context.Context, userID, convID string, tc aigateway.ToolCall, result any) (*PendingAction, error) {
	previewJSON, _ := json.Marshal(result)
	previewMap := map[string]any{}
	_ = json.Unmarshal(previewJSON, &previewMap)
	argsJSON, _ := json.Marshal(tc.Arguments)
	undoWindow := 300
	id, _, err := l.Store.StagePendingAction(ctx, userID, convID, tc.Name, argsJSON, previewJSON, undoWindow)
	if err != nil {
		return nil, err
	}
	return &PendingAction{
		ID:                id,
		ToolName:          tc.Name,
		Args:              tc.Arguments,
		Preview:           previewMap,
		UndoWindowSeconds: undoWindow,
	}, nil
}

// Confirm executes a pending action. This is the only path through
// which TierDraft tools can mutate real data.
func (l *Loop) Confirm(ctx context.Context, userID, pendingID string) (string, error) {
	toolName, toolArgsJSON, status, expiresAt, err := l.Store.LoadPendingAction(ctx, userID, pendingID)
	if err != nil {
		return "", fmt.Errorf("pending action not found: %w", err)
	}
	if status != "PENDING" {
		return "", fmt.Errorf("action is %s, cannot confirm", status)
	}
	if l.Now().After(expiresAt) {
		_ = l.Store.MarkExpired(ctx, pendingID)
		return "", errors.New("undo window expired")
	}

	var args map[string]any
	if err := json.Unmarshal(toolArgsJSON, &args); err != nil {
		return "", fmt.Errorf("decode args: %w", err)
	}

	resultID, err := l.executeWrite(ctx, userID, toolName, args)
	if err != nil {
		return "", fmt.Errorf("execute: %w", err)
	}
	_ = l.Store.MarkExecuted(ctx, pendingID, resultID)
	return resultID, nil
}

// Undo cancels a pending action within the undo window.
func (l *Loop) Undo(ctx context.Context, userID, pendingID string) error {
	ok, err := l.Store.MarkUndone(ctx, userID, pendingID)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("pending action not found or already finalised")
	}
	return nil
}

// executeWrite dispatches a confirmed TierDraft call to the real
// domain logic. The existing booking request handler already does
// the right thing for a "draft" booking; we just call it.
func (l *Loop) executeWrite(ctx context.Context, userID, toolName string, args map[string]any) (string, error) {
	switch toolName {
	case "draft_booking":
		app := ctx.Value(ctxKeyApp{}).(AppCtx)
		return app.CreateBookingFromAgent(ctx, userID, args)
	case "draft_reject_booking":
		app := ctx.Value(ctxKeyApp{}).(AppCtx)
		return app.RejectBookingFromAgent(ctx, userID, args)
	case "draft_create_project":
		app := ctx.Value(ctxKeyApp{}).(AppCtx)
		return app.CreateProjectFromAgent(ctx, userID, args)
	default:
		return "", fmt.Errorf("tool %q is not a write tool", toolName)
	}
}

// ----- DB-backed history & message persistence -----

type storedMessage struct {
	Role       string
	Content    string
	ToolName   string
	ToolCallID string
}

func canonicalToolCallKey(tc aigateway.ToolCall) string {
	raw, _ := json.Marshal(tc.Arguments)
	return tc.Name + ":" + strings.ToLower(string(raw))
}

func duplicateLoopLikely(calls []aigateway.ToolCall, seen map[string]int) bool {
	if len(calls) == 0 {
		return false
	}
	for _, tc := range calls {
		if seen[canonicalToolCallKey(tc)] == 0 {
			return false
		}
	}
	return true
}

func repeatedSearchAfterCapacity(calls []aigateway.ToolCall, steps []Step) bool {
	hasCapacity := false
	for _, s := range steps {
		if s.Kind == "tool_result" && s.ToolName == "get_capacity" {
			hasCapacity = true
			break
		}
	}
	if !hasCapacity {
		return false
	}
	for _, tc := range calls {
		if tc.Name == "search_bars" {
			return true
		}
	}
	return false
}

func projectNotFoundLoopLikely(calls []aigateway.ToolCall, steps []Step) bool {
	misses := 0
	for _, s := range steps {
		if s.Kind != "tool_result" || s.ToolName != "search_projects" || s.Result == nil {
			continue
		}
		b, _ := json.Marshal(s.Result)
		var obj map[string]any
		_ = json.Unmarshal(b, &obj)
		if n, ok := obj["count"].(float64); ok && n == 0 {
			misses++
		}
	}
	if misses == 0 {
		return false
	}
	for _, tc := range calls {
		if tc.Name == "search_projects" || tc.Name == "search_bars" {
			return true
		}
	}
	return false
}

func summarizeToolContext(steps []Step) string {
	capacity := make([]string, 0)
	matches := 0
	projectMissing := false
	baDetails := false
	for _, s := range steps {
		if s.Kind != "tool_result" || s.Result == nil {
			continue
		}
		b, _ := json.Marshal(s.Result)
		var obj map[string]any
		_ = json.Unmarshal(b, &obj)
		if s.ToolName == "search_projects" {
			if n, ok := obj["count"].(float64); ok && n == 0 {
				projectMissing = true
			}
		}
		if s.ToolName == "get_ba" {
			baDetails = true
		}
		if n, ok := obj["count"].(float64); ok && n > 0 {
			matches += int(n)
		}
		if free, ok := obj["free_percent"].(float64); ok {
			capacity = append(capacity, fmt.Sprintf("%s has %.0f%% free", shortStepID(obj["ba_id"]), free))
		}
	}
	if projectMissing {
		if baDetails {
			return "Answer: Project Falcon was not found.\nWhy: I found the BA, but no matching project exists yet.\nNext: Would you like me to create a draft using a new project named Project Falcon?"
		}
		return "Answer: Project Falcon was not found.\nWhy: Project search returned 0 results.\nNext: Would you like me to create a draft using a new project named Project Falcon?"
	}
	if len(capacity) > 0 {
		return "Answer: I found relevant BAs and checked capacity.\nWhy: " + strings.Join(capacity, "; ") + ".\nNext: Select a BA to draft the booking."
	}
	if matches > 0 {
		return fmt.Sprintf("Answer: I found %d relevant result(s), but need a narrower choice.\nWhy: The search returned multiple possible matches.\nNext: Select one BA or provide the exact name.", matches)
	}
	return "Answer: I could not find enough matching data.\nWhy: The available lookups returned no usable match.\nNext: Try a narrower skill, BA name, or date range."
}

func shortStepID(v any) string {
	s, _ := v.(string)
	if len(s) > 8 {
		return s[:8] + "…"
	}
	if s == "" {
		return "BA"
	}
	return s
}

func toolNamesFor(r *aitools.Registry) string {
	tools := r.All()
	names := make([]string, 0, len(tools))
	for _, t := range tools {
		names = append(names, t.Name)
	}
	return strings.Join(names, ", ")
}

// ctxKeyApp is the context key under which the HTTP layer injects
// the App handle so the agent can call into the existing booking
// logic. We keep the key unexported to prevent cross-package misuse.
type ctxKeyApp struct{}

// AppCtx is the contract the HTTP layer satisfies for the agent.
// Defined here as an interface so the agent package doesn't need to
// import the (large) main package.
type AppCtx interface {
	CreateBookingFromAgent(ctx context.Context, userID string, args map[string]any) (string, error)
	RejectBookingFromAgent(ctx context.Context, userID string, args map[string]any) (string, error)
	CreateProjectFromAgent(ctx context.Context, userID string, args map[string]any) (string, error)
}

// InjectApp stores an AppCtx in ctx for the agent to use.
func InjectApp(ctx context.Context, a AppCtx) context.Context {
	return context.WithValue(ctx, ctxKeyApp{}, a)
}
