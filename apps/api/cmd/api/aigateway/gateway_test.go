package aigateway

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestStubProvider_ToolSelection(t *testing.T) {
	stub := NewStubProvider()

	tools := []Tool{
		{Name: "search_bars", Description: "Search for BA profiles by skill, level, or domain."},
		{Name: "get_capacity", Description: "Get capacity for a specific BA in a date range."},
		{Name: "draft_booking", Description: "Draft a new booking (requires confirmation)."},
	}

	cases := []struct {
		input    string
		wantTool string
	}{
		{"Who is good at payments?", "search_bars"},
		{"Show me BAs in fintech", "search_bars"},
		{"What is the capacity for BA 123 in June?", "get_capacity"},
		{"Draft a booking for An on Project Falcon", "draft_booking"},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			resp, err := stub.Complete(context.Background(), Request{
				Messages: []Message{{Role: RoleUser, Content: tc.input}},
				Tools:    tools,
			})
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(resp.ToolCalls) != 1 {
				t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
			}
			if resp.ToolCalls[0].Name != tc.wantTool {
				t.Fatalf("expected %q, got %q", tc.wantTool, resp.ToolCalls[0].Name)
			}
		})
	}
}

func TestStubProvider_ChatFallback(t *testing.T) {
	stub := NewStubProvider()
	resp, err := stub.Complete(context.Background(), Request{
		System:   "Ba-Bazaar Assistant v1\nYou are helpful.",
		Messages: []Message{{Role: RoleUser, Content: "hello there"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(resp.Content), "hi") {
		t.Fatalf("expected greeting, got: %q", resp.Content)
	}
}

func TestStubProvider_JSONModeReturnsParseable(t *testing.T) {
	stub := NewStubProvider()
	resp, err := stub.Complete(context.Background(), Request{
		System:   "Brief Composer v1",
		Messages: []Message{{Role: RoleUser, Content: "Need a senior BA for KYC"}},
		JSONMode: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(strings.TrimSpace(resp.Content), "{") {
		t.Fatalf("expected JSON object, got: %q", resp.Content)
	}
}

func TestGateway_BudgetEnforcement(t *testing.T) {
	logged := 0
	gw := New(NewStubProvider(), func(LogEntry) { logged++ })
	gw.SetBudget("test_caller", 10) // 10 tokens total

	_, err := gw.Complete(context.Background(), Request{
		CallerName: "test_caller",
		System:     strings.Repeat("a", 200), // ~50 tokens, blows the budget
		Messages:   []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err != ErrBudgetExceeded {
		t.Fatalf("expected ErrBudgetExceeded, got %v", err)
	}
}

func TestGateway_LogsEveryCall(t *testing.T) {
	var entries []LogEntry
	gw := New(NewStubProvider(), func(e LogEntry) { entries = append(entries, e) })

	_, err := gw.Complete(context.Background(), Request{
		CallerName: "log_test",
		Messages:   []Message{{Role: RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(entries))
	}
	if entries[0].Caller != "log_test" {
		t.Fatalf("wrong caller: %q", entries[0].Caller)
	}
}

func TestEstimateTokens(t *testing.T) {
	if got := EstimateTokens(""); got != 0 {
		t.Fatalf("empty: %d", got)
	}
	if got := EstimateTokens(strings.Repeat("x", 100)); got != 25 {
		t.Fatalf("100 chars: expected 25, got %d", got)
	}
}

func TestHashPrompt_Stable(t *testing.T) {
	r1 := Request{System: "a", Messages: []Message{{Role: RoleUser, Content: "b"}}, Tools: []Tool{{Name: "x"}}}
	r2 := Request{System: "a", Messages: []Message{{Role: RoleUser, Content: "b"}}, Tools: []Tool{{Name: "x"}}}
	r3 := Request{System: "z", Messages: []Message{{Role: RoleUser, Content: "b"}}, Tools: []Tool{{Name: "x"}}}
	if hashPrompt(r1) != hashPrompt(r2) {
		t.Fatal("identical requests should hash the same")
	}
	if hashPrompt(r1) == hashPrompt(r3) {
		t.Fatal("different requests should hash differently")
	}
}

func TestContextCancellation(t *testing.T) {
	stub := NewStubProvider()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := stub.Complete(ctx, Request{Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err == nil {
		t.Fatal("expected cancellation error")
	}
	// A cancelled gateway call should not log success.
	if err != context.Canceled {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func TestProviderName(t *testing.T) {
	if NewStubProvider().Name() != "stub" {
		t.Fatal("name mismatch")
	}
}

// Quiet down the linter about unused import when test runs alone.
var _ = time.Now
