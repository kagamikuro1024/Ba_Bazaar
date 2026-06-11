// ai_handlers.go wires the AI Assistant v2 + Brief Composer + Manager
// Triage HTTP endpoints into the existing chi router.
//
// All endpoints are auth-gated by app.currentUser, so a request without
// a valid token gets a 401. Role checks are done at the handler level
// because the AI Assistant is available to every role — only the data
// it can see is filtered by app.currentUser's role.
//
// Endpoint surface:
//
//   POST /api/ai/agent/chat          — main chat entrypoint (Assistant v2)
//   POST /api/ai/agent/confirm       — promote a pending TierDraft action
//   POST /api/ai/agent/undo          — cancel a pending action
//   GET  /api/ai/agent/conversations — list the user's chats
//   GET  /api/ai/agent/conversations/{id}/messages — read a transcript
//   POST /api/ai/brief/parse         — Brief Composer (Week 4 flagship)
//   POST /api/ai/brief/match         — Brief Composer match step
//   POST /api/ai/triage/run          — Manager Triage (Week 5)

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"ba-bazaar-go/cmd/api/aiagent"
	"ba-bazaar-go/cmd/api/aigateway"
	"ba-bazaar-go/cmd/api/aitools"

	"github.com/go-chi/chi/v5"
)

// agentInstance is lazily created and cached on the App.
func (app *App) getAgent() *aiagent.Loop {
	app.agentOnce.Do(func() {
		app.agentLoop = aiagent.New(app.DB.Pool, app.AI, aitools.New())
	})
	return app.agentLoop
}

// ---------------------------------------------------------------------------
// Assistant v2 — chat endpoint
// ---------------------------------------------------------------------------

type agentChatRequest struct {
	ConversationID string `json:"conversation_id"`
	Message        string `json:"message"`
}

type agentChatResponse struct {
	ConversationID string                  `json:"conversation_id"`
	Final          string                  `json:"final"`
	Steps          []aiagent.Step          `json:"steps"`
	PendingActions []aiagent.PendingAction `json:"pending_actions,omitempty"`
	QuickReplies   []string                `json:"quick_replies,omitempty"`
}

func (app *App) handleAgentChat(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	var req agentChatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid JSON body."})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "message is required."})
		return
	}

	// Inject the App into the agent's context so write-tool confirmation
	// can call back into the existing booking handlers.
	ctx := aiagent.InjectApp(r.Context(), app)
	loop := app.getAgent()
	steps, final, conv, err := loop.Run(ctx, user.ID, user.Role, req.ConversationID, req.Message)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	// Collect any staged actions for the frontend to render.
	pending := collectPendingActions(steps)

	quickReplies := app.generateAgentQuickReplies(r.Context(), req.Message, final, steps, pending)

	writeJSON(w, http.StatusOK, agentChatResponse{
		ConversationID: conv,
		Final:          final,
		Steps:          steps,
		PendingActions: pending,
		QuickReplies:   quickReplies,
	})
}

func collectPendingActions(steps []aiagent.Step) []aiagent.PendingAction {
	pending := make([]aiagent.PendingAction, 0)
	for _, s := range steps {
		if s.PendingAction != nil {
			pending = append(pending, *s.PendingAction)
		}
	}
	return pending
}

func (app *App) generateAgentQuickReplies(ctx context.Context, userMessage, final string, steps []aiagent.Step, pending []aiagent.PendingAction) []string {
	if app.AI == nil {
		return fallbackQuickReplies(pending)
	}
	// Quick replies are decoration, not content. Cap the extra LLM
	// round-trip so it can never visibly delay the answer; on timeout
	// we degrade to the static fallbacks.
	ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	stepBytes, _ := json.Marshal(steps)
	pendingBytes, _ := json.Marshal(pending)
	resp, err := app.AI.Complete(ctx, aigateway.Request{
		System: `You generate short, useful follow-up button labels for a BA resource-planning assistant.
Return only JSON: {"quick_replies":["..."]}.
Rules:
- produce 3 or 4 replies
- each reply must be <= 32 characters
- make replies specific to the latest answer
- include a confirm/change/cancel style option when there is a pending action
- do not include generic greetings`,
		Messages: []aigateway.Message{{
			Role:    aigateway.RoleUser,
			Content: fmt.Sprintf("User asked: %s\nAssistant final: %s\nPending actions: %s\nSteps: %s", userMessage, final, pendingBytes, stepBytes),
		}},
		CallerName:  "agent_quick_replies",
		Temperature: 0.4,
		MaxTokens:   160,
		JSONMode:    true,
	})
	if err != nil {
		return fallbackQuickReplies(pending)
	}
	var parsed struct {
		QuickReplies []string `json:"quick_replies"`
	}
	if err := json.Unmarshal([]byte(resp.Content), &parsed); err != nil {
		return fallbackQuickReplies(pending)
	}
	return sanitizeQuickReplies(parsed.QuickReplies, pending)
}

func sanitizeQuickReplies(in []string, pending []aiagent.PendingAction) []string {
	out := make([]string, 0, 4)
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || len([]rune(s)) > 32 || seen[strings.ToLower(s)] {
			continue
		}
		seen[strings.ToLower(s)] = true
		out = append(out, s)
		if len(out) == 4 {
			return out
		}
	}
	for _, s := range fallbackQuickReplies(pending) {
		if !seen[strings.ToLower(s)] {
			out = append(out, s)
		}
		if len(out) == 4 {
			break
		}
	}
	return out
}

func fallbackQuickReplies(pending []aiagent.PendingAction) []string {
	if len(pending) > 0 {
		return []string{"Confirm draft", "Change dates", "Find another BA", "Cancel"}
	}
	return []string{"Show details", "Check capacity", "Find another BA", "Draft booking"}
}

// ---------------------------------------------------------------------------
// Assistant v2 — SSE stream endpoint
// ---------------------------------------------------------------------------
//
// GET /api/ai/agent/chat/stream?message=...&conversation_id=...&ticket=...
//
// Streams agent steps to the browser as they happen, so the user
// sees progress (tool calls, tool results, the final answer) instead
// of a single "Thinking…" pill that never updates.
//
// Auth: a one-shot ticket minted by POST /api/ai/agent/stream-ticket.
// The browser EventSource API cannot set custom request headers, so
// SOME credential has to ride in the URL; a single-use 60-second
// ticket keeps the long-lived JWT out of proxies and access logs.
// `token=...` (the raw JWT) still works as a fallback for older
// clients via app.currentUser.
//
// EventSource event types emitted:
//   "step"  — one AgentStep as JSON
//   "done"  — {conversation_id, final} at the end
//   "error" — {message} if the loop fails
//   "ping"  — heartbeat every 15s to keep proxies alive

func (app *App) handleAgentChatStream(w http.ResponseWriter, r *http.Request) {
	user, err := app.userForStream(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	q := r.URL.Query()
	message := strings.TrimSpace(q.Get("message"))
	if message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}
	convID := strings.TrimSpace(q.Get("conversation_id"))

	// SSE headers. Flusher is the only way to push events before
	// the handler returns; without it, the response buffers until
	// we close the connection.
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	// Disable nginx-style buffering when sitting behind a reverse proxy.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// http.ResponseWriter is NOT safe for concurrent writes, and both
	// the agent loop (steps/tokens) and the heartbeat goroutine write
	// to it. One mutex serialises every write+flush pair so SSE frames
	// can never interleave.
	var writeMu sync.Mutex

	send := func(event string, payload any) bool {
		data, err := json.Marshal(payload)
		if err != nil {
			return false
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		// SSE wire format: "event: <name>\ndata: <json>\n\n"
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// Heartbeat goroutine: every 15s, send a comment line. The ":" prefix
	// marks it as a comment, which EventSource ignores but keeps the
	// connection alive through proxies (CloudFront, ALB, nginx, etc.).
	stopHeartbeat := make(chan struct{})
	defer close(stopHeartbeat)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopHeartbeat:
				return
			case <-ticker.C:
				writeMu.Lock()
				_, err := fmt.Fprint(w, ": ping\n\n")
				if err == nil {
					flusher.Flush()
				}
				writeMu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()

	// Inject the App into the agent's context so write-tool confirmation
	// can call back into the existing booking handlers.
	ctx := aiagent.InjectApp(r.Context(), app)
	loop := app.getAgent()

	// Send a "started" event so the frontend knows the conversation
	// id immediately (the loop creates the row synchronously).
	send("started", map[string]string{"status": "thinking"})

	// Run the loop with a callback that pushes each step.
	streamedSteps := make([]aiagent.Step, 0, 8)
	_, final, finalConvID, err := loop.RunStream(ctx, user.ID, user.Role, convID, message, func(step aiagent.Step) {
		streamedSteps = append(streamedSteps, step)
		_ = send("step", step)
	}, func(token string) {
		_ = send("token", map[string]string{"text": token})
	})
	if err != nil {
		_ = send("error", map[string]string{"message": err.Error()})
		return
	}

	quickReplies := app.generateAgentQuickReplies(r.Context(), message, final, streamedSteps, collectPendingActions(streamedSteps))
	_ = send("actions", map[string][]string{"quick_replies": quickReplies})

	_ = send("done", map[string]string{
		"conversation_id": finalConvID,
		"final":           final,
	})
}

// ---------------------------------------------------------------------------
// Assistant v2 — SSE stream ticket
// ---------------------------------------------------------------------------

// handleAgentStreamTicket mints a one-shot, 60-second credential for
// the SSE endpoint. The client authenticates this POST with its normal
// bearer header, then opens the EventSource with ?ticket=... so the
// JWT itself never appears in a URL.
func (app *App) handleAgentStreamTicket(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ticket":     app.mintStreamTicket(user.ID),
		"expires_in": 60,
	})
}

func (app *App) mintStreamTicket(userID string) string {
	app.streamTicketMu.Lock()
	defer app.streamTicketMu.Unlock()
	if app.streamTickets == nil {
		app.streamTickets = map[string]streamTicket{}
	}
	// Opportunistic sweep keeps the map from growing unbounded.
	now := time.Now()
	for k, v := range app.streamTickets {
		if now.After(v.expiresAt) {
			delete(app.streamTickets, k)
		}
	}
	t := newUUID() + newUUID()
	app.streamTickets[t] = streamTicket{userID: userID, expiresAt: now.Add(60 * time.Second)}
	return t
}

// redeemStreamTicket consumes a ticket (single use) and returns the
// user it was minted for.
func (app *App) redeemStreamTicket(ticket string) (string, bool) {
	app.streamTicketMu.Lock()
	defer app.streamTicketMu.Unlock()
	st, ok := app.streamTickets[ticket]
	if ok {
		delete(app.streamTickets, ticket)
	}
	if !ok || time.Now().After(st.expiresAt) {
		return "", false
	}
	return st.userID, true
}

// userForStream authenticates the SSE request: prefer the one-shot
// ticket, fall back to the legacy token-in-query / header paths.
func (app *App) userForStream(r *http.Request) (*User, error) {
	if t := strings.TrimSpace(r.URL.Query().Get("ticket")); t != "" {
		userID, ok := app.redeemStreamTicket(t)
		if !ok {
			return nil, errors.New("invalid or expired stream ticket")
		}
		return app.findUserByID(r.Context(), userID)
	}
	return app.currentUser(r)
}

// ---------------------------------------------------------------------------
// Assistant v2 — confirm / undo endpoints
// ---------------------------------------------------------------------------

type agentConfirmRequest struct {
	PendingActionID string `json:"pending_action_id"`
}

func (app *App) handleAgentConfirm(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	var req agentConfirmRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid JSON body."})
		return
	}
	if strings.TrimSpace(req.PendingActionID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "pending_action_id is required."})
		return
	}
	ctx := aiagent.InjectApp(r.Context(), app)
	resultID, err := app.getAgent().Confirm(ctx, user.ID, req.PendingActionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "EXECUTED",
		"result_id": resultID,
	})
}

func (app *App) handleAgentUndo(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	var req agentConfirmRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid JSON body."})
		return
	}
	if err := app.getAgent().Undo(r.Context(), user.ID, req.PendingActionID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "UNDONE"})
}

// handleAgentPending lists the caller's still-live PENDING actions so
// the frontend can restore Confirm/Cancel cards after a page refresh.
// Optional filter: ?conversation_id=...
func (app *App) handleAgentPending(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	sql := `
		select id, coalesce(conversation_id::text, ''), tool_name, tool_args, preview,
		       undo_window_seconds, expires_at
		from ai_pending_actions
		where user_id = $1 and status = 'PENDING' and expires_at > now()`
	args := []any{user.ID}
	if convID := strings.TrimSpace(r.URL.Query().Get("conversation_id")); convID != "" {
		sql += " and conversation_id = $2"
		args = append(args, convID)
	}
	sql += " order by created_at asc limit 20"
	rows, err := app.DB.Pool.Query(r.Context(), sql, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]map[string]any, 0, 4)
	for rows.Next() {
		var id, convID, toolName string
		var argsJSON, previewJSON []byte
		var undoWindow int
		var expiresAt time.Time
		if err := rows.Scan(&id, &convID, &toolName, &argsJSON, &previewJSON, &undoWindow, &expiresAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		var argsMap, previewMap map[string]any
		_ = json.Unmarshal(argsJSON, &argsMap)
		_ = json.Unmarshal(previewJSON, &previewMap)
		out = append(out, map[string]any{
			"id":                  id,
			"conversation_id":     convID,
			"tool_name":           toolName,
			"args":                argsMap,
			"preview":             previewMap,
			"undo_window_seconds": undoWindow,
			"expires_at":          expiresAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// Conversation history
// ---------------------------------------------------------------------------

func (app *App) handleAgentConversations(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	rows, err := app.DB.Pool.Query(r.Context(), `
		select id, coalesce(title,''), created_at, updated_at
		from ai_conversations
		where user_id = $1
		order by updated_at desc
		limit 50
	`, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]map[string]any, 0, 20)
	for rows.Next() {
		var id, title string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &title, &createdAt, &updatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		out = append(out, map[string]any{
			"id": id, "title": title,
			"created_at": createdAt, "updated_at": updatedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) handleAgentMessages(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	convID := strings.TrimSpace(chiURLParam(r, "id"))
	if convID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "conversation id is required"})
		return
	}
	// Authorise: the conversation must belong to the caller.
	var owner string
	if err := app.DB.Pool.QueryRow(r.Context(), `select user_id from ai_conversations where id=$1`, convID).Scan(&owner); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "conversation not found"})
		return
	}
	if owner != user.ID {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "not your conversation"})
		return
	}
	rows, err := app.DB.Pool.Query(r.Context(), `
		select id, role, content, tool_name, tool_call_id, created_at
		from ai_messages
		where conversation_id = $1
		order by created_at asc
	`, convID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]map[string]any, 0, 20)
	for rows.Next() {
		var id, role, content string
		var toolName, toolCallID *string
		var createdAt time.Time
		if err := rows.Scan(&id, &role, &content, &toolName, &toolCallID, &createdAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		m := map[string]any{
			"id": id, "role": role, "content": content, "created_at": createdAt,
		}
		if toolName != nil {
			m["tool_name"] = *toolName
		}
		if toolCallID != nil {
			m["tool_call_id"] = *toolCallID
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// Brief Composer (Week 4 flagship)
// ---------------------------------------------------------------------------

type briefParseRequest struct {
	Text string `json:"text"`
}

// briefParseResponse mirrors the JSON shape the prompt asks for.
type briefParseResponse struct {
	Title          string   `json:"title"`
	RequiredSkills []string `json:"required_skills"`
	Level          string   `json:"level"`
	DurationWeeks  int      `json:"duration_weeks"`
	CapacityPct    int      `json:"capacity_percent"`
	Domain         string   `json:"domain"`
	Reasoning      string   `json:"reasoning"`
}

func (app *App) handleBriefParse(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	var req briefParseRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid JSON body."})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "text is required."})
		return
	}
	system, _ := aigateway.LoadPrompt("brief_composer_v1")
	if system == "" {
		system = "You are the Brief Composer. Output JSON only."
	}
	resp, err := app.AI.Complete(r.Context(), aigateway.Request{
		System:     system,
		Messages:   []aigateway.Message{{Role: aigateway.RoleUser, Content: req.Text}},
		CallerName: "brief_composer",
		UserID:     user.ID,
		JSONMode:   true,
		MaxTokens:  600,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	// The stub provider already returns parseable JSON when JSONMode is on.
	parsed, err := decodeBriefJSON(resp.Content)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"message": "Could not parse AI response: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, parsed)
}

type briefMatchRequest struct {
	Brief briefParseResponse `json:"brief"`
	Limit int                `json:"limit"`
}

type briefMatchCandidate struct {
	ID         string   `json:"id"`
	FullName   string   `json:"full_name"`
	Level      string   `json:"level"`
	Status     string   `json:"status"`
	Tags       []string `json:"tags"`
	MatchScore float64  `json:"match_score"`
	Why        string   `json:"why"`
}

type briefMatchResponse struct {
	Candidates []briefMatchCandidate `json:"candidates"`
	Brief      briefParseResponse    `json:"brief"`
}

func (app *App) handleBriefMatch(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	var req briefMatchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid JSON body."})
		return
	}
	limit := req.Limit
	if limit <= 0 || limit > 10 {
		limit = 5
	}

	// Use the existing recommendations engine to score. We build a
	// date range from the duration and a default capacity.
	start := time.Now()
	end := start.AddDate(0, 0, req.Brief.DurationWeeks*7)
	capPct := req.Brief.CapacityPct
	if capPct == 0 {
		capPct = 50
	}
	// Pull a candidate list using the recommendations handler logic.
	// We re-implement the scoring call here because the recommendations
	// HTTP handler is tied to a request-shaped contract we don't want
	// to leak into the brief composer.
	candidates, err := app.briefScoreCandidates(r.Context(), req.Brief, start, end, capPct, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	_ = user // user is captured in audit log via caller name
	writeJSON(w, http.StatusOK, briefMatchResponse{
		Candidates: candidates,
		Brief:      req.Brief,
	})
}

// briefScoreCandidates runs the existing recommendations engine then
// adds an LLM-generated "why" line per candidate.
func (app *App) briefScoreCandidates(ctx context.Context, brief briefParseResponse, start, end time.Time, capPct, limit int) ([]briefMatchCandidate, error) {
	// We delegate the heavy lifting to /api/ba/recommendations via
	// the in-process function call. Since the existing handler is
	// HTTP-shaped we re-implement the smallest useful subset.
	sql := `select b.id, b.full_name, b.level, b.status,
	               coalesce(string_agg(st.name, ',' order by st.name), '') as tags
	        from ba_profiles b
	        left join ba_skill_tags bst on bst.ba_id = b.id
	        left join skill_tags st on st.id = bst.tag_id
	        where b.status = 'ACTIVE'
	        group by b.id
	        order by b.full_name asc
	        limit 25`
	rows, err := app.DB.Pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		id, name, level, status, tags string
	}
	var all []row
	for rows.Next() {
		var rr row
		if err := rows.Scan(&rr.id, &rr.name, &rr.level, &rr.status, &rr.tags); err != nil {
			return nil, err
		}
		all = append(all, rr)
	}
	// Score: +3 per matched skill, +1 for level match, capped.
	wantSkills := map[string]bool{}
	for _, s := range brief.RequiredSkills {
		wantSkills[strings.ToLower(s)] = true
	}
	type scored struct {
		row
		score float64
		why   string
	}
	results := make([]scored, 0, len(all))
	for _, rr := range all {
		var s float64
		matched := 0
		for _, t := range strings.Split(rr.tags, ",") {
			t = strings.ToLower(strings.TrimSpace(t))
			if t == "" {
				continue
			}
			if wantSkills[t] {
				s += 3
				matched++
			}
		}
		if brief.Level != "" && rr.level == brief.Level {
			s += 1
		}
		why := fmt.Sprintf("Matches %d/%d required skills", matched, len(brief.RequiredSkills))
		if matched == 0 {
			why = "No direct skill match — consider as a stretch assignment."
		}
		results = append(results, scored{row: rr, score: s, why: why})
	}
	// Sort by score desc.
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].score > results[i].score {
				results[i], results[j] = results[j], results[i]
			}
		}
	}
	if len(results) > limit {
		results = results[:limit]
	}
	out := make([]briefMatchCandidate, 0, len(results))
	for _, r := range results {
		out = append(out, briefMatchCandidate{
			ID: r.id, FullName: r.name, Level: r.level, Status: r.status,
			Tags: splitTrimmed(r.tags, ","), MatchScore: r.score, Why: r.why,
		})
	}
	return out, nil
}

func splitTrimmed(s, sep string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// decodeBriefJSON pulls a briefParseResponse out of whatever the
// model returned. It's lenient: it will accept a string containing
// JSON (the gateway sometimes wraps in {"reply": "..."}).
func decodeBriefJSON(s string) (briefParseResponse, error) {
	var b briefParseResponse
	// First try direct.
	if err := json.Unmarshal([]byte(s), &b); err == nil && b.Title != "" {
		return b, nil
	}
	// Try wrapped {"reply": "..."}.
	var wrap struct {
		Reply string `json:"reply"`
	}
	if err := json.Unmarshal([]byte(s), &wrap); err == nil && wrap.Reply != "" {
		if err := json.Unmarshal([]byte(wrap.Reply), &b); err == nil && b.Title != "" {
			return b, nil
		}
	}
	// Last resort: return a structured default so the frontend can
	// still render something.
	return briefParseResponse{
		Title:          "Drafted brief",
		RequiredSkills: []string{},
		Level:          "MIDDLE",
		DurationWeeks:  4,
		CapacityPct:    50,
		Domain:         "unspecified",
		Reasoning:      "AI response was not parseable; please edit manually.",
	}, errors.New("response not parseable as Brief JSON")
}

// ---------------------------------------------------------------------------
// Manager Triage (Week 5)
// ---------------------------------------------------------------------------

type triageRequest struct {
	BookingID string `json:"booking_id"`
}

type triageLane string

const (
	laneAuto      triageLane = "auto_approve"
	laneJudgement triageLane = "needs_judgment"
	laneNoFit     triageLane = "likely_no_fit"
)

type triageResponse struct {
	BookingID       string     `json:"booking_id"`
	Lane            triageLane `json:"lane"`
	Confidence      float64    `json:"confidence"`
	Reasoning       string     `json:"reasoning"`
	SuggestedAction string     `json:"suggested_action"`
}

func (app *App) handleTriageRun(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if user.Role != "BA_MANAGER" && user.Role != "ADMIN" {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager only."})
		return
	}
	var req triageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid JSON body."})
		return
	}
	if req.BookingID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "booking_id is required."})
		return
	}
	// Load the booking's headline facts.
	var title, status, priority string
	var baID *string
	if err := app.DB.Pool.QueryRow(r.Context(),
		`select title, status, priority, ba_id from bookings where id=$1`,
		req.BookingID).Scan(&title, &status, &priority, &baID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "booking not found"})
		return
	}
	// Cheap heuristic triage for the stub provider; the real LLM
	// would do something more nuanced.
	lane := laneJudgement
	confidence := 0.5
	reasoning := "Defaulted to needs_judgment because no LLM-specific signal was available."
	suggested := "review manually"
	if status != "PENDING" {
		lane = laneJudgement
		reasoning = "Booking is not in PENDING state; nothing to triage."
		confidence = 0.95
	} else if priority == "URGENT" {
		lane = laneJudgement
		reasoning = "URGENT priority — managers should look personally."
		confidence = 0.85
		suggested = "review manually"
	} else if baID == nil {
		lane = laneNoFit
		reasoning = "No BA assigned yet — would benefit from AI matching."
		confidence = 0.7
		suggested = "run a match against the BA pool"
	}
	writeJSON(w, http.StatusOK, triageResponse{
		BookingID:       req.BookingID,
		Lane:            lane,
		Confidence:      confidence,
		Reasoning:       reasoning,
		SuggestedAction: suggested,
	})
}

// ---------------------------------------------------------------------------
// AppCtx implementation — called by the agent on Confirm
// ---------------------------------------------------------------------------

// canCreateProject mirrors canCreateBookingRequest: in this product,
// projects are created in service of booking requests.
func canCreateProject(role string) bool { return role == "PM_PO" || role == "BA_MANAGER" }

// requireAgentRole loads the user fresh from the DB and applies a role
// predicate. The agent staging path already checks roles, but this is
// the authoritative gate: Confirm must never execute a write the
// equivalent HTTP endpoint would have refused.
func (app *App) requireAgentRole(ctx context.Context, userID string, allowed func(string) bool, what string) error {
	user, err := app.findUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("requester not found: %w", err)
	}
	if !allowed(user.Role) {
		return fmt.Errorf("your role (%s) is not permitted to %s", user.Role, what)
	}
	return nil
}

// CreateBookingFromAgent satisfies aiagent.AppCtx. It inserts a
// PENDING booking just like the standard /bookings/request endpoint
// would, but it does not require an HTTP request.
func (app *App) CreateBookingFromAgent(ctx context.Context, userID string, args map[string]any) (string, error) {
	// Same gate as POST /bookings/request.
	if err := app.requireAgentRole(ctx, userID, canCreateBookingRequest, "create booking requests (PM/PO or BA Manager required)"); err != nil {
		return "", err
	}

	// Pull args. The staged JSON is model-emitted and user-confirmed,
	// but it is still untrusted input — validate everything the booking
	// endpoint's contract implies before touching the table.
	get := func(k string) (string, error) {
		v, ok := args[k]
		if !ok || v == nil {
			return "", fmt.Errorf("missing %q", k)
		}
		s, ok := v.(string)
		if !ok {
			return "", fmt.Errorf("%q must be a string", k)
		}
		if strings.TrimSpace(s) == "" {
			return "", fmt.Errorf("%q is empty", k)
		}
		return s, nil
	}
	baID, err := get("ba_id")
	if err != nil {
		return "", err
	}
	projectID, err := get("project_id")
	if err != nil {
		return "", err
	}
	title, err := get("title")
	if err != nil {
		return "", err
	}
	startStr, err := get("start_date")
	if err != nil {
		return "", err
	}
	endStr, err := get("end_date")
	if err != nil {
		return "", err
	}
	start, err := time.Parse("2006-01-02", startStr)
	if err != nil {
		return "", fmt.Errorf("start_date: %w", err)
	}
	end, err := time.Parse("2006-01-02", endStr)
	if err != nil {
		return "", fmt.Errorf("end_date: %w", err)
	}
	if end.Before(start) {
		return "", errors.New("end_date is before start_date")
	}
	capPct := 50
	if v, ok := args["capacity_percent"]; ok {
		switch n := v.(type) {
		case float64:
			capPct = int(n)
		case int:
			capPct = n
		}
	}
	if capPct != 50 && capPct != 100 {
		return "", errors.New("capacity_percent must be 50 or 100")
	}
	priority := "MEDIUM"
	if p, ok := args["priority"].(string); ok && p != "" {
		priority = p
	}
	switch priority {
	case "LOW", "MEDIUM", "HIGH", "URGENT":
	default:
		return "", fmt.Errorf("priority %q is not one of LOW, MEDIUM, HIGH, URGENT", priority)
	}
	description := ""
	if d, ok := args["description"].(string); ok {
		description = d
	}

	// Hard rule from the assistant contract: never book a BA who is
	// RESIGNED or ON_LEAVE. The status may have changed between draft
	// and confirm, so this must be checked here, not just at preview.
	var baStatus string
	if err := app.DB.Pool.QueryRow(ctx, `select status from ba_profiles where id=$1`, baID).Scan(&baStatus); err != nil {
		return "", fmt.Errorf("ba not found: %w", err)
	}
	if baStatus != "ACTIVE" {
		return "", fmt.Errorf("BA is %s and cannot be booked", baStatus)
	}

	// Insert.
	id, err := app.createBooking(ctx, userID, baID, projectID, title, description,
		start, end, capPct, priority)
	if err != nil {
		return "", err
	}
	return id, nil
}

// RejectBookingFromAgent satisfies aiagent.AppCtx.
func (app *App) RejectBookingFromAgent(ctx context.Context, userID string, args map[string]any) (string, error) {
	// Same gate as POST /bookings/{id}/reject.
	if err := app.requireAgentRole(ctx, userID, canApproveBooking, "reject bookings (BA Manager required)"); err != nil {
		return "", err
	}
	bookingID, _ := args["booking_id"].(string)
	if bookingID == "" {
		return "", errors.New("booking_id required")
	}
	reason, _ := args["reason"].(string)
	if reason == "" {
		return "", errors.New("reason required")
	}
	if err := app.aiRejectBooking(ctx, userID, bookingID, reason); err != nil {
		return "", err
	}
	return bookingID, nil
}

// CreateProjectFromAgent satisfies aiagent.AppCtx. It creates a new
// project on the same path as the implicit booking flow, returning
// the new project's id.
func (app *App) CreateProjectFromAgent(ctx context.Context, userID string, args map[string]any) (string, error) {
	if err := app.requireAgentRole(ctx, userID, canCreateProject, "create projects (PM/PO or BA Manager required)"); err != nil {
		return "", err
	}
	name, _ := args["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("name required")
	}
	description, _ := args["description"].(string)
	color, _ := args["color"].(string)
	if strings.TrimSpace(color) == "" {
		color = "#2563EB"
	}
	id, err := app.createProject(ctx, name, description, color)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (app *App) createProject(ctx context.Context, name, description, color string) (string, error) {
	id := newUUID()
	desc := strings.TrimSpace(description)
	if desc == "" {
		desc = "Created from AI assistant"
	}
	_, err := app.DB.Pool.Exec(ctx, `
		insert into projects (id, name, color, description, created_at, updated_at)
		values ($1, $2, $3, $4, now(), now())
	`, id, name, color, desc)
	if err != nil {
		return "", err
	}
	return id, nil
}

// createBooking inserts a PENDING booking. Defined as a method on
// App so both the HTTP handler and the agent path use identical SQL.
func (app *App) createBooking(ctx context.Context, userID, baID, projectID, title, description string,
	start, end time.Time, capPct int, priority string) (string, error) {
	const q = `
		insert into bookings
		  (ba_id, project_id, requester_id, title, description,
		   start_date, end_date, capacity_percent, priority, status, created_at, updated_at)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING', now(), now())
		returning id
	`
	var id string
	err := app.DB.Pool.QueryRow(ctx, q, baID, projectID, userID, title, description,
		start, end, capPct, priority).Scan(&id)
	return id, err
}

func (app *App) aiRejectBooking(ctx context.Context, userID, bookingID, reason string) error {
	const q = `
		update bookings
		set status='REJECTED',
		    reject_reason=$2,
		    rejected_at=now(),
		    manager_id=coalesce(manager_id, $1),
		    updated_at=now()
		where id=$3 and status='PENDING'
	`
	tag, err := app.DB.Pool.Exec(ctx, q, userID, reason, bookingID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("booking not in PENDING state")
	}
	return nil
}

// chiURLParam is a tiny helper that delegates to chi.URLParam. We
// keep it as a shim so the rest of the handler file can read like
// prose without chi imports scattered around.
func chiURLParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}
