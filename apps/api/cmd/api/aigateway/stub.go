package aigateway

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
)

// StubProvider is a deterministic, dependency-free LLM stand-in.
//
// It does not call any external service. It exists so the rest of the
// product (Brief Composer, AI Assistant, Manager Triage) is fully
// functional in dev/CI and on a laptop with no API keys.
//
// Behaviour:
//   - For tool-calling requests it returns a *single* tool call picked
//     from the Tools list by simple keyword matching against the user
//     message. This is enough to drive the agent loop end-to-end.
//   - For chat requests it returns a templated answer drawn from
//     a tiny in-memory knowledge base keyed on the System prompt name
//     (the first line of System is treated as a "persona id").
//   - For JSONMode it always returns parseable JSON, optionally
//     wrapped in the most common shape callers ask for.
//
// Why not just call OpenAI in dev? Three reasons:
//   1. CI must run hermetic. Network calls break that.
//   2. The product should be demoable offline.
//   3. Predictability matters for tests; we want zero flakiness from
//      upstream rate limits or model drift.
//
// Adding a real provider is a 30-line file: implement Provider.
type StubProvider struct {
	modelName string
}

func NewStubProvider() *StubProvider {
	return &StubProvider{modelName: "stub-deterministic-1"}
}

func (s *StubProvider) Name() string         { return "stub" }
func (s *StubProvider) DefaultModel() string { return s.modelName }

// Complete satisfies Provider. See package comment for the algorithm.
func (s *StubProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if err := ctx.Err(); err != nil {
		return Response{}, err
	}

	// Pull the last user message as the operative input.
	lastUser := ""
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == RoleUser {
			lastUser = req.Messages[i].Content
			break
		}
	}
	combined := strings.ToLower(lastUser)

	// Tool-calling path: pick the best-matching tool, return one call.
	if len(req.Tools) > 0 {
		tc, ok := s.chooseTool(combined, req.Tools)
		if ok {
			return Response{
				Content:   "",
				ToolCalls: []ToolCall{tc},
				Provider:  s.Name(),
				Model:     s.modelName,
			}, nil
		}
		// No tool matched → return a chat answer explaining so.
		return Response{
			Content:  "I could not identify a matching capability for that request.",
			Provider: s.Name(),
			Model:    s.modelName,
		}, nil
	}

	// Plain chat: persona-driven templates.
	persona := firstLine(req.System)
	body := s.chatReply(persona, combined)

	if req.JSONMode {
		body = wrapAsJSON(body)
	}
	return Response{
		Content:  body,
		Provider: s.Name(),
		Model:    s.modelName,
	}, nil
}

// chooseTool does lightweight keyword routing. Order of preference:
//  1. Exact tool-name mention ("search_bars" → search_bars).
//  2. Description keyword overlap.
//  3. If only one tool is available, use it.
func (s *StubProvider) chooseTool(input string, tools []Tool) (ToolCall, bool) {
	if len(tools) == 1 {
		return s.makeCall(tools[0], input), true
	}

	// Score each tool.
	type scored struct {
		idx   int
		score int
	}
	scores := make([]scored, 0, len(tools))
	for i, t := range tools {
		s := 0
		if strings.Contains(input, strings.ToLower(t.Name)) {
			s += 10
		}
		// Score description keyword overlap.
		words := tokenise(t.Description)
		for _, w := range words {
			if len(w) >= 4 && strings.Contains(input, w) {
				s++
			}
		}
		// Intent-based boosts. The model is just doing keyword
		// matching, but the description and the human input both
		// use the same vocabulary, so this works well enough for
		// the agent loop to exercise every code path.
		switch t.Name {
		case "search_bars":
			for _, kw := range []string{"who", "find", "search", "ba", "analyst", "skill", "level", "domain", "good at", "available"} {
				if strings.Contains(input, kw) {
					s += 2
				}
			}
		case "get_capacity":
			for _, kw := range []string{"capacity", "available", "free", "busy", "utilization", "utilisation"} {
				if strings.Contains(input, kw) {
					s += 2
				}
			}
		case "list_bookings":
			for _, kw := range []string{"list", "show bookings", "pending", "approved", "schedule"} {
				if strings.Contains(input, kw) {
					s += 2
				}
			}
		case "draft_booking":
			for _, kw := range []string{"draft", "book", "create booking", "new booking", "assign"} {
				if strings.Contains(input, kw) {
					s += 2
				}
			}
		case "explain_metric":
			for _, kw := range []string{"explain", "why", "metric", "trend", "anomaly"} {
				if strings.Contains(input, kw) {
					s += 2
				}
			}
		}
		scores = append(scores, scored{i, s})
	}
	best := scores[0]
	for _, x := range scores[1:] {
		if x.score > best.score {
			best = x
		}
	}
	if best.score == 0 {
		return ToolCall{}, false
	}
	return s.makeCall(tools[best.idx], input), true
}

// makeCall fabricates arguments based on the input string. Real LLMs do
// much better; this exists only to keep the agent loop testable.
func (s *StubProvider) makeCall(t Tool, input string) ToolCall {
	args := map[string]any{}
	switch t.Name {
	case "search_bars":
		args["query"] = extractQuery(input)
	case "get_capacity":
		// Default to current month for a usable demo.
		args["ba_id"] = extractBAID(input)
		args["start_date"] = "first day of this month"
		args["end_date"] = "last day of this month"
	case "list_bookings":
		args["status"] = extractStatus(input)
		args["ba_id"] = extractBAID(input)
	case "draft_booking":
		args["ba_id"] = extractBAID(input)
		args["title"] = strings.TrimSpace(input)
		args["start_date"] = "next Monday"
		args["end_date"] = "+6 weeks from start"
		args["capacity_percent"] = 50
	case "explain_metric":
		args["metric"] = extractMetric(input)
		args["range"] = "last 30 days"
	}
	return ToolCall{
		ID:        "call_" + t.Name + "_1",
		Name:      t.Name,
		Arguments: args,
	}
}

// chatReply returns a deterministic answer for a given persona + intent.
func (s *StubProvider) chatReply(persona, input string) string {
	switch {
	case strings.Contains(input, "hello") || strings.Contains(input, "hi"):
		return "Hi! I'm the Ba-Bazaar AI assistant. Ask me about BA capacity, bookings, or who is available."
	case strings.Contains(input, "help") || strings.Contains(input, "what can you"):
		return "I can: search for BAs by skill, show capacity, list bookings, draft a new booking (requires manager approval), and explain weekly metrics."
	case strings.Contains(input, "thanks") || strings.Contains(input, "thank you"):
		return "You're welcome."
	}
	// Generic persona fallback. Keep it short and human.
	return "Based on the data I have: " + fallbackSentence(input) + " (stub response — wire a real LLM provider to enrich this)."
}

// ----- helpers -----

var nonWord = regexp.MustCompile(`[^a-z0-9_]+`)

func tokenise(s string) []string {
	s = strings.ToLower(s)
	return nonWord.Split(s, -1)
}

func firstLine(s string) string {
	if i := strings.Index(s, "\n"); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

// extractQuery strips known prefixes ("search for", "find") and quotes.
func extractQuery(input string) string {
	q := input
	for _, prefix := range []string{"search for", "search", "find", "who is", "who are", "show me"} {
		if strings.HasPrefix(strings.ToLower(q), prefix) {
			q = q[len(prefix):]
			break
		}
	}
	return strings.TrimSpace(stripQuotes(q))
}

// extractBAID is a placeholder; the agent loop's tool implementations
// resolve the id by name if missing. Returning empty is fine.
func extractBAID(input string) string {
	lower := strings.ToLower(input)
	if i := strings.Index(lower, "ba id "); i >= 0 {
		return strings.TrimSpace(input[i+6:])
	}
	return ""
}

func extractStatus(input string) string {
	lower := strings.ToLower(input)
	for _, s := range []string{"pending", "approved", "in_progress", "in progress", "completed", "rejected", "cancelled"} {
		if strings.Contains(lower, s) {
			return strings.ReplaceAll(s, " ", "_")
		}
	}
	return ""
}

func extractMetric(input string) string {
	lower := strings.ToLower(input)
	for _, m := range []string{"utilization", "utilisation", "bookings", "capacity", "no-show", "cancellation"} {
		if strings.Contains(lower, m) {
			return m
		}
	}
	return "utilization"
}

func stripQuotes(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

func fallbackSentence(input string) string {
	if input == "" {
		return "no specific question was provided"
	}
	if len(input) > 200 {
		return "you asked a long-form question that I can answer in more detail once a real LLM is wired up"
	}
	return "you asked: \"" + input + "\""
}

// wrapAsJSON forces a parseable JSON object out of free-form text.
// It always returns a top-level object with `reply` set.
func wrapAsJSON(s string) string {
	payload := map[string]any{"reply": s}
	b, err := json.Marshal(payload)
	if err != nil {
		// Last-resort: hand-build a valid JSON object.
		return `{"reply":"unparseable"}`
	}
	return string(b)
}
