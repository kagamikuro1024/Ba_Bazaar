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
	// Defensive: some models still wrap JSON in code fences.
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	return strings.TrimSpace(content), nil
}
