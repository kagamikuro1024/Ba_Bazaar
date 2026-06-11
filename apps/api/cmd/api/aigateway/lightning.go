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

// LightningProvider calls Lightning AI's OpenAI-compatible chat completions API.
type LightningProvider struct {
	apiKey     string
	baseURL    string
	model      string
	httpClient *http.Client
}

func NewLightningProvider() *LightningProvider {
	return &LightningProvider{
		apiKey:     strings.TrimSpace(os.Getenv("LIGHTNING_API_KEY")),
		baseURL:    strings.TrimRight(envOrDefault("LIGHTNING_BASE_URL", "https://lightning.ai/api/v1"), "/"),
		model:      envOrDefault("LIGHTNING_MODEL", "lightning-ai/gpt-oss-120b"),
		httpClient: &http.Client{Timeout: 75 * time.Second},
	}
}

func (l *LightningProvider) Name() string { return "lightning" }

func (l *LightningProvider) Configured() bool {
	return l != nil && strings.TrimSpace(l.apiKey) != ""
}

func (l *LightningProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if l == nil {
		return Response{}, errors.New("lightning: provider not initialised")
	}
	if !l.Configured() {
		return Response{}, errors.New("lightning: LIGHTNING_API_KEY not set")
	}

	model := req.Model
	if model == "" {
		model = l.model
	}

	payload := lightningRequest{
		Model:       model,
		Messages:    buildLightningMessages(req),
		Temperature: pickFloat(req.Temperature, 0.2),
		MaxTokens:   pickInt(req.MaxTokens, 800),
	}
	if len(req.Tools) > 0 {
		payload.Tools = buildLightningTools(req.Tools)
	}
	if req.JSONMode {
		payload.Messages = append(payload.Messages, lightningMessage{
			Role:    "system",
			Content: "You must respond with a single JSON object and nothing else.",
		})
	}

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return Response{}, fmt.Errorf("lightning: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, l.baseURL+"/chat/completions", bytes.NewReader(rawPayload))
	if err != nil {
		return Response{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+l.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := l.httpClient.Do(httpReq)
	if err != nil {
		return Response{}, fmt.Errorf("lightning: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return Response{}, fmt.Errorf("lightning: status %d: %s", resp.StatusCode, truncate(string(raw), 500))
	}

	var parsed lightningResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Response{}, fmt.Errorf("lightning: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Response{}, errors.New("lightning: empty choices")
	}

	choice := parsed.Choices[0].Message
	out := Response{
		Content:  choice.Text(),
		Provider: l.Name(),
		Model:    firstNonEmpty(parsed.Model, model),
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

type lightningRequest struct {
	Model       string             `json:"model"`
	Messages    []lightningMessage `json:"messages"`
	Tools       []lightningTool    `json:"tools,omitempty"`
	Temperature float64            `json:"temperature,omitempty"`
	MaxTokens   int                `json:"max_tokens,omitempty"`
}

type lightningMessage struct {
	Role       string         `json:"role"`
	Content    any            `json:"content"`
	Name       string         `json:"name,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
	ToolCalls  []wireToolCall `json:"tool_calls,omitempty"`
}

type lightningTool struct {
	Type     string         `json:"type"`
	Function map[string]any `json:"function"`
}

type lightningToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type lightningContentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type lightningResponseMessage struct {
	Content   any                 `json:"content"`
	ToolCalls []lightningToolCall `json:"tool_calls"`
}

func (m lightningResponseMessage) Text() string {
	switch v := m.Content.(type) {
	case string:
		return v
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := obj["text"].(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

type lightningResponse struct {
	Choices []struct {
		Message lightningResponseMessage `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Model string `json:"model"`
}

func buildLightningMessages(req Request) []lightningMessage {
	msgs := make([]lightningMessage, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, lightningMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		lm := lightningMessage{Role: string(m.Role), Name: m.Name, ToolCallID: m.ToolID}
		if m.Role == RoleUser {
			lm.Content = []lightningContentPart{{Type: "text", Text: m.Content}}
		} else {
			lm.Content = m.Content
		}
		lm.ToolCalls = wireToolCalls(m.ToolCalls)
		msgs = append(msgs, lm)
	}
	return msgs
}

func buildLightningTools(tools []Tool) []lightningTool {
	out := make([]lightningTool, 0, len(tools))
	for _, t := range tools {
		out = append(out, lightningTool{
			Type: "function",
			Function: map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.Parameters,
			},
		})
	}
	return out
}
