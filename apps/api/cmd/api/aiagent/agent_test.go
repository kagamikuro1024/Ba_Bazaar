package aiagent

import (
	"context"
	"errors"
	"testing"
	"time"

	"ba-bazaar-go/cmd/api/aigateway"
	"ba-bazaar-go/cmd/api/aitools"
)

// fakeStore satisfies Store without touching Postgres. It records
// the operations so tests can assert on them.
type fakeStore struct {
	conversations  map[string]bool
	messages       []storedMessage
	pendingActions map[string]*fakePending
	now            time.Time
}

type fakePending struct {
	userID    string
	toolName  string
	args      []byte
	preview   []byte
	status    string
	expiresAt time.Time
	resultID  string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		conversations:  map[string]bool{},
		pendingActions: map[string]*fakePending{},
		now:            time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC),
	}
}

func (f *fakeStore) AppendMessage(ctx context.Context, convID, role, content string, toolCallID, toolName string) error {
	f.messages = append(f.messages, storedMessage{
		Role: role, Content: content, ToolCallID: toolCallID, ToolName: toolName,
	})
	return nil
}

func (f *fakeStore) LoadHistory(ctx context.Context, convID string, limit int) ([]storedMessage, error) {
	// Return whatever messages exist for the conv; in tests there
	// is only ever one conv anyway.
	if limit > len(f.messages) {
		limit = len(f.messages)
	}
	return f.messages, nil
}

func (f *fakeStore) EnsureConversation(ctx context.Context, userID, convID, firstMessage string) (string, error) {
	if convID != "" && f.conversations[convID] {
		return convID, nil
	}
	id := "conv-" + userID + "-auto"
	f.conversations[id] = true
	return id, nil
}

func (f *fakeStore) StagePendingAction(ctx context.Context, userID, convID, toolName string, argsJSON, previewJSON []byte, undoWindowSeconds int) (string, time.Time, error) {
	id := "pending-1"
	expires := f.now.Add(time.Duration(undoWindowSeconds) * time.Second)
	f.pendingActions[id] = &fakePending{
		userID:    userID,
		toolName:  toolName,
		args:      argsJSON,
		preview:   previewJSON,
		status:    "PENDING",
		expiresAt: expires,
	}
	return id, expires, nil
}

func (f *fakeStore) LoadPendingAction(ctx context.Context, userID, pendingID string) (string, []byte, string, time.Time, error) {
	p, ok := f.pendingActions[pendingID]
	if !ok || p.userID != userID {
		return "", nil, "", time.Time{}, errors.New("not found")
	}
	return p.toolName, p.args, p.status, p.expiresAt, nil
}

func (f *fakeStore) MarkExecuted(ctx context.Context, pendingID, resultID string) error {
	p, ok := f.pendingActions[pendingID]
	if !ok {
		return errors.New("not found")
	}
	p.status = "EXECUTED"
	p.resultID = resultID
	return nil
}

func (f *fakeStore) MarkExpired(ctx context.Context, pendingID string) error {
	if p, ok := f.pendingActions[pendingID]; ok {
		p.status = "EXPIRED"
	}
	return nil
}

func (f *fakeStore) MarkUndone(ctx context.Context, userID, pendingID string) (bool, error) {
	p, ok := f.pendingActions[pendingID]
	if !ok || p.userID != userID || p.status != "PENDING" {
		return false, nil
	}
	p.status = "UNDONE"
	return true, nil
}

func (f *fakeStore) LookupUserByID(ctx context.Context, userID string) (string, error) {
	return "Test User", nil
}

// scriptedProvider feeds a fixed sequence of model responses.
type scriptedProvider struct {
	responses []aigateway.Response
	idx       int
}

func (s *scriptedProvider) Name() string { return "scripted" }
func (s *scriptedProvider) Complete(ctx context.Context, req aigateway.Request) (aigateway.Response, error) {
	if s.idx >= len(s.responses) {
		return aigateway.Response{Content: "(no more scripted responses)"}, nil
	}
	r := s.responses[s.idx]
	s.idx++
	return r, nil
}

func newLoop(prov *scriptedProvider, store *fakeStore) *Loop {
	gw := aigateway.New(prov, nil)
	tools := aitools.New()
	return &Loop{
		DB:           nil, // not used in tests
		Store:        store,
		Gateway:      gw,
		Tools:        tools,
		SystemPrompt: "p",
		Now:          func() time.Time { return store.now },
	}
}

func TestRun_FinalTextNoTools(t *testing.T) {
	prov := &scriptedProvider{responses: []aigateway.Response{
		{Content: "Hello! How can I help?"},
	}}
	store := newFakeStore()
	l := newLoop(prov, store)
	steps, final, conv, err := l.Run(context.Background(), "user-1", "", "hi there")
	if err != nil {
		t.Fatal(err)
	}
	if conv == "" {
		t.Fatal("expected a new conversation id")
	}
	if final != "Hello! How can I help?" {
		t.Fatalf("final: %q", final)
	}
	if len(steps) != 1 || steps[0].Kind != "final" {
		t.Fatalf("steps: %+v", steps)
	}
}

func TestRun_ToolCallThenFinal(t *testing.T) {
	prov := &scriptedProvider{responses: []aigateway.Response{
		{Content: "", ToolCalls: []aigateway.ToolCall{
			{ID: "c1", Name: "search_bars", Arguments: map[string]any{"query": "payments"}},
		}},
		{Content: "I found BAs with payments experience."},
	}}
	l := newLoop(prov, newFakeStore())
	steps, final, _, err := l.Run(context.Background(), "user-1", "", "who is good at payments?")
	if err != nil {
		t.Fatal(err)
	}
	if final == "" {
		t.Fatal("expected final text")
	}
	hasCall, hasResult, hasFinal := false, false, false
	for _, s := range steps {
		switch s.Kind {
		case "tool_call":
			hasCall = true
			if s.ToolName != "search_bars" {
				t.Fatalf("wrong tool: %s", s.ToolName)
			}
		case "tool_result":
			hasResult = true
		case "final":
			hasFinal = true
		}
	}
	if !hasCall || !hasResult || !hasFinal {
		t.Fatalf("missing steps: %+v", steps)
	}
}

func TestRun_MutatingToolStagesPendingAction(t *testing.T) {
	prov := &scriptedProvider{responses: []aigateway.Response{
		{Content: "", ToolCalls: []aigateway.ToolCall{
			{ID: "c1", Name: "draft_booking", Arguments: map[string]any{
				"ba_id": "ba-1", "project_id": "p-1", "title": "KYC work",
				"start_date": "2026-07-01", "end_date": "2026-07-15",
				"capacity_percent": 50,
			}},
		}},
		{Content: "(should not appear)"},
	}}
	store := newFakeStore()
	l := newLoop(prov, store)
	steps, _, _, err := l.Run(context.Background(), "user-1", "", "draft a booking for An on Falcon")
	if err != nil {
		t.Fatal(err)
	}
	// Mutating tool should have stopped the loop after one model call.
	if len(prov.responses)-prov.idx != 1 {
		t.Fatalf("mutating tool should stop the loop, %d responses left", len(prov.responses)-prov.idx)
	}
	var staged *PendingAction
	for _, s := range steps {
		if s.PendingAction != nil {
			staged = s.PendingAction
		}
	}
	if staged == nil {
		t.Fatalf("no pending action in steps: %+v", steps)
	}
	if staged.ToolName != "draft_booking" {
		t.Fatalf("wrong tool: %s", staged.ToolName)
	}
	if staged.UndoWindowSeconds != 300 {
		t.Fatalf("undo window: %d", staged.UndoWindowSeconds)
	}
	if staged.ID == "" {
		t.Fatal("staged action must have an id")
	}
	// Verify the underlying store row.
	if len(store.pendingActions) != 1 {
		t.Fatalf("expected 1 pending action, got %d", len(store.pendingActions))
	}
	for _, p := range store.pendingActions {
		if p.status != "PENDING" {
			t.Fatalf("status: %s", p.status)
		}
	}
}

func TestRun_UnknownToolDoesNotPanic(t *testing.T) {
	prov := &scriptedProvider{responses: []aigateway.Response{
		{Content: "", ToolCalls: []aigateway.ToolCall{
			{ID: "c1", Name: "delete_everything", Arguments: map[string]any{}},
		}},
		{Content: "Sorry, I cannot do that."},
	}}
	l := newLoop(prov, newFakeStore())
	_, _, _, err := l.Run(context.Background(), "user-1", "", "delete everything")
	if err != nil {
		t.Fatal(err)
	}
}

func TestRun_EmptyUserText(t *testing.T) {
	l := newLoop(&scriptedProvider{}, newFakeStore())
	_, _, _, err := l.Run(context.Background(), "u", "", "  ")
	if err == nil {
		t.Fatal("expected error for empty text")
	}
}

func TestRun_MaxIterationCap(t *testing.T) {
	prov := &scriptedProvider{}
	for i := 0; i < 20; i++ {
		prov.responses = append(prov.responses, aigateway.Response{
			Content: "",
			ToolCalls: []aigateway.ToolCall{{
				ID: "c", Name: "search_bars", Arguments: map[string]any{"query": "x"},
			}},
		})
	}
	l := newLoop(prov, newFakeStore())
	steps, final, _, err := l.Run(context.Background(), "u", "", "loop forever")
	if err != nil {
		t.Fatal(err)
	}
	if !contains(final, "already tried") && !contains(final, "available lookups") {
		t.Fatalf("loop guard message missing: %q", final)
	}
	if prov.idx >= MaxIterations {
		t.Fatalf("expected loop guard before %d calls, got %d", MaxIterations, prov.idx)
	}
	if len(steps) < 2 {
		t.Fatalf("expected tool steps, got %d", len(steps))
	}
}

func TestUndo_OnlyMarksPending(t *testing.T) {
	store := newFakeStore()
	store.pendingActions["p1"] = &fakePending{
		userID: "u", toolName: "draft_booking", status: "PENDING",
		expiresAt: store.now.Add(5 * time.Minute),
	}
	prov := &scriptedProvider{}
	l := newLoop(prov, store)
	if err := l.Undo(context.Background(), "u", "p1"); err != nil {
		t.Fatal(err)
	}
	if store.pendingActions["p1"].status != "UNDONE" {
		t.Fatalf("status: %s", store.pendingActions["p1"].status)
	}
	// Idempotent: second call fails.
	if err := l.Undo(context.Background(), "u", "p1"); err == nil {
		t.Fatal("expected error on second undo")
	}
}

func TestUndo_WrongUser(t *testing.T) {
	store := newFakeStore()
	store.pendingActions["p1"] = &fakePending{
		userID: "alice", toolName: "draft_booking", status: "PENDING",
		expiresAt: store.now.Add(5 * time.Minute),
	}
	l := newLoop(&scriptedProvider{}, store)
	if err := l.Undo(context.Background(), "bob", "p1"); err == nil {
		t.Fatal("expected error when wrong user")
	}
}

func TestConfirm_UndoWindowExpired(t *testing.T) {
	store := newFakeStore()
	store.pendingActions["p1"] = &fakePending{
		userID: "u", toolName: "draft_booking", status: "PENDING",
		expiresAt: store.now.Add(-time.Minute), // already expired
	}
	l := newLoop(&scriptedProvider{}, store)
	ctx := InjectApp(context.Background(), &fakeApp{})
	if _, err := l.Confirm(ctx, "u", "p1"); err == nil {
		t.Fatal("expected expiry error")
	}
	if store.pendingActions["p1"].status != "EXPIRED" {
		t.Fatalf("expected EXPIRED status, got %s", store.pendingActions["p1"].status)
	}
}

func TestConfirm_AlreadyFinalised(t *testing.T) {
	store := newFakeStore()
	store.pendingActions["p1"] = &fakePending{
		userID: "u", toolName: "draft_booking", status: "EXECUTED",
		expiresAt: store.now.Add(5 * time.Minute),
	}
	l := newLoop(&scriptedProvider{}, store)
	ctx := InjectApp(context.Background(), &fakeApp{})
	if _, err := l.Confirm(ctx, "u", "p1"); err == nil {
		t.Fatal("expected error for already-executed action")
	}
}

// fakeApp satisfies AppCtx for Confirm tests.
type fakeApp struct{}

func (f *fakeApp) CreateBookingFromAgent(ctx context.Context, userID string, args map[string]any) (string, error) {
	return "booking-99", nil
}
func (f *fakeApp) RejectBookingFromAgent(ctx context.Context, userID string, args map[string]any) (string, error) {
	return "rejected-99", nil
}
func (f *fakeApp) CreateProjectFromAgent(ctx context.Context, userID string, args map[string]any) (string, error) {
	return "project-99", nil
}

func TestConfirm_DraftBookingPromotedToReal(t *testing.T) {
	store := newFakeStore()
	store.pendingActions["p1"] = &fakePending{
		userID:    "u",
		toolName:  "draft_booking",
		status:    "PENDING",
		expiresAt: store.now.Add(5 * time.Minute),
		args:      []byte(`{"ba_id":"b","project_id":"p","title":"t","start_date":"2026-07-01","end_date":"2026-07-15","capacity_percent":50}`),
	}
	l := newLoop(&scriptedProvider{}, store)
	ctx := InjectApp(context.Background(), &fakeApp{})
	resultID, err := l.Confirm(ctx, "u", "p1")
	if err != nil {
		t.Fatal(err)
	}
	if resultID != "booking-99" {
		t.Fatalf("expected booking-99, got %s", resultID)
	}
	if store.pendingActions["p1"].status != "EXECUTED" {
		t.Fatalf("status: %s", store.pendingActions["p1"].status)
	}
	if store.pendingActions["p1"].resultID != "booking-99" {
		t.Fatalf("resultID: %s", store.pendingActions["p1"].resultID)
	}
}

func TestRegistry_TierClassification(t *testing.T) {
	tools := aitools.New()
	if !tools.IsMutating("draft_booking") {
		t.Fatal("draft_booking must be tier 2")
	}
	if tools.IsMutating("search_bars") {
		t.Fatal("search_bars must be tier 1")
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// TestRunStream_PushesStepsInOrder exercises the streaming contract:
// the onStep callback is invoked for every step in the order they
// are produced, BEFORE RunStream returns. This is the contract the
// SSE handler relies on to flush events to the browser.
func TestRunStream_PushesStepsInOrder(t *testing.T) {
	prov := &scriptedProvider{responses: []aigateway.Response{
		{Content: "", ToolCalls: []aigateway.ToolCall{
			{ID: "c1", Name: "search_bars", Arguments: map[string]any{"query": "x"}},
		}},
		{Content: "all done"},
	}}
	l := newLoop(prov, newFakeStore())
	var streamed []string
	steps, final, _, err := l.RunStream(context.Background(), "u", "", "test", func(s Step) {
		streamed = append(streamed, s.Kind+":"+s.ToolName)
	})
	if err != nil {
		t.Fatal(err)
	}
	if final != "all done" {
		t.Fatalf("final: %q", final)
	}
	want := []string{"tool_call:search_bars", "tool_result:search_bars", "final:"}
	if len(streamed) < len(want) {
		t.Fatalf("expected at least %d streamed events, got %d (%v)", len(want), len(streamed), streamed)
	}
	for i, w := range want {
		if streamed[i] != w {
			t.Fatalf("event %d: want %q, got %q", i, w, streamed[i])
		}
	}
	if len(steps) != len(streamed) {
		t.Fatalf("steps %d != streamed %d", len(steps), len(streamed))
	}
}

// TestRunStream_StopsOnContextCancel verifies the loop bails early
// when the client disconnects mid-stream. Without this, an
// EventSource close would keep making LLM calls nobody is listening
// to.
func TestRunStream_StopsOnContextCancel(t *testing.T) {
	blocking := &blockingProvider{}
	gw := aigateway.New(blocking, nil)
	store := newFakeStore()
	l := &Loop{
		DB: nil, Store: store, Gateway: gw, Tools: aitools.New(),
		SystemPrompt: "p", Now: func() time.Time { return store.now },
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	_, _, _, err := l.RunStream(ctx, "u", "", "test", func(Step) {})
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
}

// blockingProvider blocks on Complete until ctx is done.
type blockingProvider struct{}

func (b *blockingProvider) Name() string { return "blocking" }
func (b *blockingProvider) Complete(ctx context.Context, req aigateway.Request) (aigateway.Response, error) {
	<-ctx.Done()
	return aigateway.Response{}, ctx.Err()
}
