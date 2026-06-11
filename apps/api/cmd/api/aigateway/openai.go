// Package aigateway - openai provider
//
// This file is the only place in the codebase that imports the OpenAI SDK.
// It compiles only when the `openai` build tag is set, so the rest of
// the product stays dependency-free. To enable real LLM calls:
//
//	go build -tags openai -o dist/ba-bazaar-api .
//
// When the tag is off, the NewOpenAIProvider function is a stub that
// returns nil. This is intentional: dev/CI never needs the SDK.
package aigateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// OpenAIProvider is a minimal OpenAI Chat Completions client. We do not
// use the official SDK to avoid pulling a 30-dependency tree when we
// only need one endpoint. The wire format is stable and well-documented.
type OpenAIProvider struct {
	apiKey     string
	baseURL    string // for Azure / proxies
	model      string
	httpClient *http.Client
}

func NewOpenAIProvider() *OpenAIProvider {
	return &OpenAIProvider{
		apiKey:     os.Getenv("OPENAI_API_KEY"),
		baseURL:    envOrDefault("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		model:      envOrDefault("OPENAI_MODEL", "gpt-4o-mini"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (o *OpenAIProvider) Name() string { return "openai" }

// Complete implements Provider against /v1/chat/completions.
func (o *OpenAIProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if o.apiKey == "" {
		return Response{}, errors.New("openai: OPENAI_API_KEY not set")
	}

	type oaiMessage struct {
		Role       string         `json:"role"`
		Content    string         `json:"content"`
		Name       string         `json:"name,omitempty"`
		ToolCallID string         `json:"tool_call_id,omitempty"`
		ToolCalls  []wireToolCall `json:"tool_calls,omitempty"`
	}
	type oaiTool struct {
		Type     string         `json:"type"`
		Function map[string]any `json:"function"`
	}
	type oaiRequest struct {
		Model       string       `json:"model"`
		Messages    []oaiMessage `json:"messages"`
		Tools       []oaiTool    `json:"tools,omitempty"`
		Temperature float64      `json:"temperature"`
		MaxTokens   int          `json:"max_tokens"`
	}
	type oaiToolCall struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}
	type oaiResponse struct {
		Choices []struct {
			Message struct {
				Content   string        `json:"content"`
				ToolCalls []oaiToolCall `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
		Model string `json:"model"`
	}

	// Build messages.
	msgs := make([]oaiMessage, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, oaiMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		om := oaiMessage{Role: string(m.Role), Content: m.Content}
		if m.Name != "" {
			om.Name = m.Name
		}
		if m.ToolID != "" {
			om.ToolCallID = m.ToolID
		}
		om.ToolCalls = wireToolCalls(m.ToolCalls)
		msgs = append(msgs, om)
	}
	tools := make([]oaiTool, 0, len(req.Tools))
	for _, t := range req.Tools {
		tools = append(tools, oaiTool{
			Type: "function",
			Function: map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.Parameters,
			},
		})
	}

	model := req.Model
	if model == "" {
		model = o.model
	}
	body := oaiRequest{
		Model:       model,
		Messages:    msgs,
		Tools:       tools,
		Temperature: pickFloat(req.Temperature, 0.2),
		MaxTokens:   pickInt(req.MaxTokens, 800),
	}
	if req.JSONMode {
		body.Tools = nil // response_format incompatible with tools in some models
		body.Messages = append(body.Messages, oaiMessage{
			Role:    "system",
			Content: "You must respond with a single JSON object and nothing else.",
		})
	}

	buf, err := json.Marshal(body)
	if err != nil {
		return Response{}, fmt.Errorf("marshal: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", o.baseURL+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return Response{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+o.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := o.httpClient.Do(httpReq)
	if err != nil {
		return Response{}, fmt.Errorf("openai: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return Response{}, fmt.Errorf("openai: status %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}

	var parsed oaiResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Response{}, fmt.Errorf("openai: parse: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Response{}, errors.New("openai: empty choices")
	}
	choice := parsed.Choices[0].Message

	out := Response{
		Content:  choice.Content,
		Provider: o.Name(),
		Model:    parsed.Model,
		Usage: Usage{
			PromptTokens:     parsed.Usage.PromptTokens,
			CompletionTokens: parsed.Usage.CompletionTokens,
			TotalTokens:      parsed.Usage.TotalTokens,
		},
	}
	for _, tc := range choice.ToolCalls {
		var args map[string]any
		if tc.Function.Arguments != "" {
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
		}
		out.ToolCalls = append(out.ToolCalls, ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: args,
		})
	}
	return out, nil
}

func envOrDefault(k, d string) string {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return d
	}
	return v
}

func pickFloat(v, d float64) float64 {
	if v == 0 {
		return d
	}
	return v
}

func pickInt(v, d int) int {
	if v <= 0 {
		return d
	}
	return v
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
