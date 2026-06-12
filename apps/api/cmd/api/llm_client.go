package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// ============================================================================
// Shared DeepSeek client.
//
// One HTTP client + one call helper for every AI feature (skill extraction,
// page summaries). JSON mode is enforced via response_format so we stop
// hand-stripping ``` fences and re-parsing malformed output.
// ============================================================================

var deepSeekHTTPClient = &http.Client{Timeout: 60 * time.Second}

type deepSeekChatRequest struct {
	System      string
	User        string
	Temperature float64
	MaxTokens   int
}

// callDeepSeekJSON sends a chat request with JSON output mode and returns the
// raw JSON string from the first choice. Callers unmarshal into their own
// schema and must validate the result.
func callDeepSeekJSON(ctx context.Context, request deepSeekChatRequest) (string, error) {
	apiKey := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY"))
	if apiKey == "" {
		return "", fmt.Errorf("DEEPSEEK_API_KEY is not configured")
	}
	model := envOr("DEEPSEEK_MODEL", "deepseek-chat")
	baseURL := strings.TrimRight(envOr("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), "/")

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": request.System},
			{"role": "user", "content": request.User},
		},
		"temperature":     request.Temperature,
		"response_format": map[string]string{"type": "json_object"},
	}
	if request.MaxTokens > 0 {
		payload["max_tokens"] = request.MaxTokens
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := deepSeekHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("deepseek status %d", resp.StatusCode)
	}

	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", err
	}
	if len(decoded.Choices) == 0 {
		return "", fmt.Errorf("deepseek returned no choices")
	}

	content := strings.TrimSpace(decoded.Choices[0].Message.Content)
	return extractDeepSeekJSONContent(content)
}

func extractDeepSeekJSONContent(content string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", fmt.Errorf("deepseek returned empty JSON content")
	}

	content = stripMarkdownJSONFence(content)
	if isJSONObject(content) && json.Valid([]byte(content)) {
		return content, nil
	}

	if object, ok := firstJSONObject(content); ok {
		return object, nil
	}

	return "", fmt.Errorf("deepseek returned invalid JSON content")
}

func stripMarkdownJSONFence(content string) string {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, "```") {
		return content
	}

	if newline := strings.IndexByte(content, '\n'); newline >= 0 {
		content = content[newline+1:]
	} else {
		content = strings.TrimPrefix(content, "```")
	}
	content = strings.TrimSpace(content)
	content = strings.TrimSuffix(content, "```")
	return strings.TrimSpace(content)
}

func isJSONObject(content string) bool {
	content = strings.TrimSpace(content)
	return strings.HasPrefix(content, "{") && strings.HasSuffix(content, "}")
}

func firstJSONObject(content string) (string, bool) {
	start := strings.IndexByte(content, '{')
	if start < 0 {
		return "", false
	}

	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(content); index++ {
		ch := content[index]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			switch ch {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}

		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				candidate := strings.TrimSpace(content[start : index+1])
				return candidate, json.Valid([]byte(candidate))
			}
		}
	}

	return "", false
}
