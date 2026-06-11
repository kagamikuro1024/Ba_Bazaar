//go:build live_bedrock

// Run with:
//
//   BEDROCK_BEARER_TOKEN=*** \
//   go test -tags live_bedrock -v -run LiveBedrock ./aigateway/...
//
// Hits the real model end-to-end through the AWS SDK v2 Converse API.
// Skips cleanly when BEDROCK_BEARER_TOKEN is empty.

package aigateway

import (
	"context"
	"testing"
	"time"
)

func TestLiveBedrock_TextReply(t *testing.T) {
	if bedrockBearerToken() == "" {
		t.Skip("BEDROCK_BEARER_TOKEN or AWS_BEARER_TOKEN_BEDROCK not set; skipping live test")
	}
	p, err := NewBedrockProvider()
	if err != nil {
		t.Fatal(err)
	}
	if !p.Configured() {
		t.Fatal("provider reports not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp, err := p.Complete(ctx, Request{
		System:      "You are a concise assistant.",
		Messages:    []Message{{Role: RoleUser, Content: "Reply with exactly: bedrock ok"}},
		MaxTokens:   20,
		Temperature: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content == "" {
		t.Fatal("empty content")
	}
	t.Logf("response: %q (model=%s, tokens=%d)", resp.Content, resp.Model, resp.Usage.TotalTokens)
}

func TestLiveBedrock_ToolCall(t *testing.T) {
	if bedrockBearerToken() == "" {
		t.Skip("BEDROCK_BEARER_TOKEN or AWS_BEARER_TOKEN_BEDROCK not set; skipping live test")
	}
	p, err := NewBedrockProvider()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp, err := p.Complete(ctx, Request{
		System: "You are the Ba-Bazaar AI assistant. You can call tools.",
		Messages: []Message{{
			Role:    RoleUser,
			Content: "Search for a BA with payments experience.",
		}},
		Tools: []Tool{{
			Name:        "search_bars",
			Description: "Search BAs by free-text query (skills, domain, availability).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
				},
				"required": []string{"query"},
			},
		}},
		MaxTokens:   300,
		Temperature: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.ToolCalls) == 0 {
		t.Fatalf("expected a tool call, got content=%q", resp.Content)
	}
	if resp.ToolCalls[0].Name != "search_bars" {
		t.Fatalf("wrong tool: %s", resp.ToolCalls[0].Name)
	}
	t.Logf("tool call: name=%s args=%v", resp.ToolCalls[0].Name, resp.ToolCalls[0].Arguments)
}
