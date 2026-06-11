package aitools

import (
	"context"
	"testing"
)

func TestRegistry_AllRegistered(t *testing.T) {
	r := New()
	want := []string{
		"draft_booking", "draft_reject_booking",
		"get_ba", "get_capacity", "list_bookings", "search_bars",
	}
	for _, name := range want {
		if _, ok := r.Get(name); !ok {
			t.Fatalf("missing tool: %s", name)
		}
	}
}

func TestRegistry_IsMutating(t *testing.T) {
	r := New()
	if r.IsMutating("search_bars") {
		t.Fatal("search_bars must be tier 1")
	}
	if !r.IsMutating("draft_booking") {
		t.Fatal("draft_booking must be tier 2")
	}
	if !r.IsMutating("draft_reject_booking") {
		t.Fatal("draft_reject_booking must be tier 2")
	}
}

func TestRegistry_AsGatewayTools(t *testing.T) {
	r := New()
	gw := r.AsGatewayTools()
	if len(gw) != len(r.All()) {
		t.Fatalf("mismatch: %d vs %d", len(gw), len(r.All()))
	}
	for _, t1 := range gw {
		if t1.Name == "" {
			t.Fatal("empty name")
		}
		if t1.Description == "" {
			t.Fatalf("%s has empty description", t1.Name)
		}
		if t1.Parameters == nil {
			t.Fatalf("%s has nil parameters", t1.Name)
		}
	}
}

func TestArgHelpers(t *testing.T) {
	if _, err := argString(map[string]any{}, "x"); err == nil {
		t.Fatal("expected error for missing key")
	}
	if _, err := argString(map[string]any{"x": 42}, "x"); err == nil {
		t.Fatal("expected error for non-string")
	}
	if v, _ := argString(map[string]any{"x": " hi "}, "x"); v != "hi" {
		t.Fatalf("expected trim, got %q", v)
	}
	if v, _ := argInt(map[string]any{"x": 1.0}, "x"); v != 1 {
		t.Fatalf("float conversion: %d", v)
	}
	if _, err := argInt(map[string]any{"x": "1"}, "x"); err == nil {
		t.Fatal("expected error for non-number string")
	}
	got := argStringList(map[string]any{"x": []any{"a", "", "b"}}, "x")
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("list: %v", got)
	}
}

func TestSplitNonEmpty(t *testing.T) {
	got := splitNonEmpty("a, b , ,c", ",")
	if len(got) != 3 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("split: %v", got)
	}
	if len(splitNonEmpty("", ",")) != 0 {
		t.Fatal("empty input should return empty slice")
	}
}

// TestToolRunWithNilDB exercises the graceful path: draft_booking does
// not panic when the pool is nil and returns a usable preview built
// from the raw ids.
func TestToolRunWithNilDB(t *testing.T) {
	r := New()
	t1, _ := r.Get("draft_booking")
	res, err := t1.Run(context.Background(), nil, map[string]any{
		"ba_id":            "ba-123",
		"project_id":       "p-9",
		"title":            "Test booking",
		"start_date":       "2026-07-01",
		"end_date":         "2026-07-15",
		"capacity_percent": 50,
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	preview, ok := res.(map[string]any)
	if !ok {
		t.Fatalf("preview not a map: %T", res)
	}
	if !preview["requires_confirmation"].(bool) {
		t.Fatal("draft must always require confirmation")
	}
	draft := preview["draft"].(map[string]any)
	if draft["ba_id"] != "ba-123" || draft["project_id"] != "p-9" {
		t.Fatalf("ids not preserved: %v", draft)
	}
}
