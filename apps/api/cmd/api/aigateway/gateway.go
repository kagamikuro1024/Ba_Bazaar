// Package aigateway is the single entry point for all LLM calls in
// ba-bazaar-api. It is provider-agnostic: every consumer (Brief Composer,
// AI Assistant, Manager Triage, Skill Normalization) talks to this gateway
// and never to an LLM SDK directly.
//
// Why this exists:
//   - Centralise prompt versioning (all prompts live in prompts/*.md)
//   - Enforce per-request token budgets
//   - Persist every call to ai_decisions for explainability
//   - Make it trivial to swap providers (stub today, OpenAI tomorrow)
//   - Keep the rest of the codebase free of LLM-specific types
package aigateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// Role is a chat role, kept minimal so callers don't import LLM SDKs.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message is one turn in a conversation.
type Message struct {
	Role    Role   `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
	ToolID  string `json:"tool_call_id,omitempty"`
}

// Tool describes one callable function exposed to the model.
type Tool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Parameters is a JSON Schema object describing the function args.
	Parameters map[string]any `json:"parameters"`
}

// ToolCall is the model's request to invoke a tool.
type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

// Response is the gateway's normalised reply.
type Response struct {
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
	// Usage is opaque to callers but useful for cost control.
	Usage    Usage  `json:"usage"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// LatencyMS is wall-clock for the round trip.
	LatencyMS int64 `json:"latency_ms"`
}

// Usage is best-effort token accounting. Stub provider estimates only.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// Request is what a caller hands the gateway.
type Request struct {
	// System is the persona + grounding prompt for the call.
	System string
	// Messages is the conversation so far (excluding the System prompt).
	Messages []Message
	// Tools is the function-calling schema. Empty means plain chat.
	Tools []Tool
	// Model is the provider-specific model id. Empty → provider default.
	Model string
	// Temperature, 0..1. 0 is deterministic. Default 0.2.
	Temperature float64
	// MaxTokens is a hard ceiling on the response. Default 800.
	MaxTokens int
	// JSONMode forces structured output. We use a strict prompt
	// (response_format=json) when the provider supports it; otherwise
	// the stub just guarantees parseable JSON via PostProcess.
	JSONMode bool
	// CallerName is logged to ai_decisions.caller for accountability.
	CallerName string
	// UserID, if known, is also logged.
	UserID string
	// OnToken, when set, receives best-effort streamed text deltas from
	// providers that support token streaming.
	OnToken func(string) `json:"-"`
}

// EstimateTokens returns an approximate token count for cost budgets.
// Uses the ~4-chars-per-token heuristic, which is fine for soft limits.
func EstimateTokens(s string) int {
	if s == "" {
		return 0
	}
	// Round up to never under-budget on a hard cap.
	return (len(s) + 3) / 4
}

// Provider is the interface every concrete LLM backend must satisfy.
// We keep it tiny: one method, one response struct.
type Provider interface {
	Name() string
	Complete(ctx context.Context, req Request) (Response, error)
}

// Gateway is the public façade.
type Gateway struct {
	provider Provider
	mu       sync.Mutex
	// log is a function the host app supplies; the gateway itself
	// does not depend on the database so it stays unit-testable.
	log func(entry LogEntry)
	// budgets per caller name. If a request would exceed the budget
	// the gateway returns ErrBudgetExceeded before hitting the provider.
	budgets map[string]int
	// used is cumulative tokens spent this process lifetime, per caller.
	used map[string]int
}

// LogEntry is what gets persisted to ai_decisions.
type LogEntry struct {
	Caller       string    `json:"caller"`
	UserID       string    `json:"user_id,omitempty"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	PromptHash   string    `json:"prompt_hash"`
	PromptTokens int       `json:"prompt_tokens"`
	OutputTokens int       `json:"output_tokens"`
	TotalTokens  int       `json:"total_tokens"`
	LatencyMS    int64     `json:"latency_ms"`
	Success      bool      `json:"success"`
	ErrorMessage string    `json:"error_message,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// ErrBudgetExceeded is returned when a caller has burned through its
// soft token budget for the current process. The host can decide whether
// to surface this as 429 or just log and degrade gracefully.
var ErrBudgetExceeded = errors.New("ai gateway: token budget exceeded for caller")

// New constructs a Gateway. Provider must be non-nil.
func New(provider Provider, log func(LogEntry)) *Gateway {
	return &Gateway{
		provider: provider,
		log:      log,
		budgets:  map[string]int{},
		used:     map[string]int{},
	}
}

// SetBudget caps total tokens per caller for the lifetime of the
// gateway (i.e. for the process). 0 = unlimited.
func (g *Gateway) SetBudget(caller string, tokens int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.budgets[caller] = tokens
}

// hashPrompt produces a stable fingerprint so the audit table can group
// repeat calls and surface regressions.
func hashPrompt(r Request) string {
	h := sha256.New()
	// Hash a canonical form. We sort tool names so reordering is stable.
	toolNames := make([]string, 0, len(r.Tools))
	for _, t := range r.Tools {
		toolNames = append(toolNames, t.Name)
	}
	sort.Strings(toolNames)
	h.Write([]byte(r.System))
	h.Write([]byte{0})
	for _, m := range r.Messages {
		h.Write([]byte(m.Role))
		h.Write([]byte{0})
		h.Write([]byte(m.Content))
		h.Write([]byte{0})
	}
	h.Write([]byte(strings.Join(toolNames, ",")))
	sum := h.Sum(nil)
	return hex.EncodeToString(sum[:8])
}

// Complete is the only method consumers should call. It enforces budgets,
// stamps timing, fires the log callback, and normalises errors.
func (g *Gateway) Complete(ctx context.Context, req Request) (Response, error) {
	if g == nil || g.provider == nil {
		return Response{}, errors.New("ai gateway: not initialised")
	}
	if req.CallerName == "" {
		req.CallerName = "unspecified"
	}

	// Estimate prompt size for budget check.
	promptChars := len(req.System)
	for _, m := range req.Messages {
		promptChars += len(m.Content)
	}
	estPromptTokens := EstimateTokens(req.System + strings.Repeat("x", promptChars))

	g.mu.Lock()
	if cap, ok := g.budgets[req.CallerName]; ok && cap > 0 {
		if g.used[req.CallerName]+estPromptTokens > cap {
			g.mu.Unlock()
			return Response{}, ErrBudgetExceeded
		}
	}
	g.mu.Unlock()

	start := time.Now()
	resp, err := g.provider.Complete(ctx, req)
	elapsed := time.Since(start)

	// Fill in usage estimate if the provider didn't.
	if resp.Usage.PromptTokens == 0 {
		resp.Usage.PromptTokens = estPromptTokens
	}
	if resp.Usage.CompletionTokens == 0 {
		resp.Usage.CompletionTokens = EstimateTokens(resp.Content)
	}
	if resp.Usage.TotalTokens == 0 {
		resp.Usage.TotalTokens = resp.Usage.PromptTokens + resp.Usage.CompletionTokens
	}
	resp.LatencyMS = elapsed.Milliseconds()
	if resp.Provider == "" {
		resp.Provider = g.provider.Name()
	}

	// Record spend.
	g.mu.Lock()
	g.used[req.CallerName] += resp.Usage.TotalTokens
	g.mu.Unlock()

	// Fire log callback best-effort. We never fail a request because
	// logging failed — observability is not on the critical path.
	if g.log != nil {
		entry := LogEntry{
			Caller:       req.CallerName,
			UserID:       req.UserID,
			Provider:     resp.Provider,
			Model:        resp.Model,
			PromptHash:   hashPrompt(req),
			PromptTokens: resp.Usage.PromptTokens,
			OutputTokens: resp.Usage.CompletionTokens,
			TotalTokens:  resp.Usage.TotalTokens,
			LatencyMS:    resp.LatencyMS,
			Success:      err == nil,
			CreatedAt:    time.Now(),
		}
		if err != nil {
			entry.ErrorMessage = err.Error()
		}
		g.log(entry)
	}

	return resp, err
}

// MarshalJSONRequest is a tiny helper for tests/debug logs.
func MarshalJSONRequest(r Request) (string, error) {
	b, err := json.Marshal(r)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}
	return string(b), nil
}
