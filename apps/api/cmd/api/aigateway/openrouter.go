package aigateway

import (
	"bufio"
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

// OpenRouterProvider calls OpenRouter's OpenAI-compatible chat completions API.
type OpenRouterProvider struct {
	apiKey     string
	baseURL    string
	model      string
	httpClient *http.Client
}

func NewOpenRouterProvider() *OpenRouterProvider {
	return &OpenRouterProvider{
		apiKey:     strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")),
		baseURL:    strings.TrimRight(envOrDefault("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), "/"),
		model:      envOrDefault("OPENROUTER_MODEL", "openai/gpt-oss-120b"),
		httpClient: &http.Client{Timeout: 75 * time.Second},
	}
}

func (o *OpenRouterProvider) Name() string { return "openrouter" }

func (o *OpenRouterProvider) Configured() bool {
	return o != nil && strings.TrimSpace(o.apiKey) != ""
}

func (o *OpenRouterProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if o == nil {
		return Response{}, errors.New("openrouter: provider not initialised")
	}
	if !o.Configured() {
		return Response{}, errors.New("openrouter: OPENROUTER_API_KEY not set")
	}

	model := req.Model
	if model == "" {
		model = o.model
	}

	payload := openRouterRequest{
		Model:       model,
		Messages:    buildOpenRouterMessages(req),
		Temperature: pickFloat(req.Temperature, 0.2),
		MaxTokens:   pickInt(req.MaxTokens, 800),
	}
	if len(req.Tools) > 0 {
		payload.Tools = buildOpenRouterTools(req.Tools)
	}
	if req.OnToken != nil && len(req.Tools) == 0 && !req.JSONMode {
		payload.Stream = true
	}
	if req.JSONMode {
		payload.Messages = append(payload.Messages, openRouterMessage{
			Role:    "system",
			Content: "You must respond with a single JSON object and nothing else.",
		})
	}

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return Response{}, fmt.Errorf("openrouter: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(rawPayload))
	if err != nil {
		return Response{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+o.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("HTTP-Referer", envOrDefault("OPENROUTER_SITE_URL", "http://localhost:3000"))
	httpReq.Header.Set("X-Title", envOrDefault("OPENROUTER_APP_NAME", "Ba Bazaar"))

	resp, err := o.httpClient.Do(httpReq)
	if err != nil {
		return Response{}, fmt.Errorf("openrouter: %w", err)
	}
	defer resp.Body.Close()

	if payload.Stream {
		if resp.StatusCode >= 400 {
			raw, _ := io.ReadAll(resp.Body)
			return Response{}, fmt.Errorf("openrouter: status %d: %s", resp.StatusCode, truncate(string(raw), 500))
		}
		return o.readStream(resp.Body, model, req.OnToken)
	}

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return Response{}, fmt.Errorf("openrouter: status %d: %s", resp.StatusCode, truncate(string(raw), 500))
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return Response{}, errors.New("openrouter: empty response body")
	}

	var parsed openRouterResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Response{}, fmt.Errorf("openrouter: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Response{}, errors.New("openrouter: empty choices")
	}

	choice := parsed.Choices[0].Message
	out := Response{
		Content:  choice.Text(),
		Provider: o.Name(),
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

func (o *OpenRouterProvider) readStream(body io.Reader, model string, onToken func(string)) (Response, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var content strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk openRouterStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content == "" {
				continue
			}
			content.WriteString(choice.Delta.Content)
			if onToken != nil {
				onToken(choice.Delta.Content)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return Response{}, fmt.Errorf("openrouter stream: %w", err)
	}
	return Response{Content: content.String(), Provider: o.Name(), Model: model}, nil
}

type openRouterStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

type openRouterRequest struct {
	Model       string              `json:"model"`
	Messages    []openRouterMessage `json:"messages"`
	Tools       []openRouterTool    `json:"tools,omitempty"`
	Temperature float64             `json:"temperature,omitempty"`
	MaxTokens   int                 `json:"max_tokens,omitempty"`
	Stream      bool                `json:"stream,omitempty"`
}

type openRouterMessage struct {
	Role       string `json:"role"`
	Content    any    `json:"content"`
	Name       string `json:"name,omitempty"`
	ToolCallID string `json:"tool_call_id,omitempty"`
}

type openRouterTool struct {
	Type     string         `json:"type"`
	Function map[string]any `json:"function"`
}

type openRouterToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openRouterContentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type openRouterResponseMessage struct {
	Content   any                  `json:"content"`
	ToolCalls []openRouterToolCall `json:"tool_calls"`
}

func (m openRouterResponseMessage) Text() string {
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

type openRouterResponse struct {
	Choices []struct {
		Message openRouterResponseMessage `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Model string `json:"model"`
}

func buildOpenRouterMessages(req Request) []openRouterMessage {
	msgs := make([]openRouterMessage, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, openRouterMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		om := openRouterMessage{Role: string(m.Role), Name: m.Name, ToolCallID: m.ToolID}
		if m.Role == RoleUser {
			om.Content = []openRouterContentPart{{Type: "text", Text: m.Content}}
		} else {
			om.Content = m.Content
		}
		msgs = append(msgs, om)
	}
	return msgs
}

func buildOpenRouterTools(tools []Tool) []openRouterTool {
	out := make([]openRouterTool, 0, len(tools))
	for _, t := range tools {
		out = append(out, openRouterTool{
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
