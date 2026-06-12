package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type dashboardLLMSummary struct {
	Summary     string                      `json:"summary"`
	Bullets     []dashboardLLMSummaryBullet `json:"bullets"`
	Citations   []dashboardLLMCitation      `json:"citations"`
	Provider    string                      `json:"provider"`
	Grounded    bool                        `json:"grounded"`
	Reason      string                      `json:"reason,omitempty"`
	Cached      bool                        `json:"cached,omitempty"`
	CacheKey    string                      `json:"cache_key,omitempty"`
	Fingerprint string                      `json:"fingerprint,omitempty"`
}

type dashboardLLMSummaryBullet struct {
	Text      string   `json:"text"`
	Citations []string `json:"citations"`
}

type dashboardLLMCitation struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Value string `json:"value"`
}

type cachedDashboardLLMSummary struct {
	Fingerprint string
	Summary     *dashboardLLMSummary
}

var dashboardLLMCache = struct {
	sync.Mutex
	items map[string]cachedDashboardLLMSummary
}{items: map[string]cachedDashboardLLMSummary{}}

const dashboardLLMCacheMaxEntries = 100

func (app *App) handleDashboardManagerLLMSummary(w http.ResponseWriter, r *http.Request) {
	payload, status, err := app.managerSummaryPayload(r)
	if err != nil {
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}

	cacheKey := dashboardLLMCacheKey(r)
	fingerprint := dashboardLLMFingerprint(payload)
	if cached := getCachedDashboardLLMSummary(cacheKey, fingerprint); cached != nil {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), dashboardLLMTimeout())
	defer cancel()
	if summary, err := summarizeDashboardWithDeepSeek(ctx, payload); err == nil {
		rememberDashboardLLMSummary(cacheKey, fingerprint, summary)
		summary.CacheKey = shortHash(cacheKey)
		summary.Fingerprint = shortHash(fingerprint)
		writeJSON(w, http.StatusOK, summary)
		return
	} else {
		fallback := buildGroundedDashboardFallback(payload, safeDashboardLLMReason(err))
		rememberDashboardLLMSummary(cacheKey, fingerprint, fallback)
		fallback.CacheKey = shortHash(cacheKey)
		fallback.Fingerprint = shortHash(fingerprint)
		writeJSON(w, http.StatusOK, fallback)
		return
	}
}

func dashboardLLMCacheKey(r *http.Request) string {
	return strings.Join([]string{strings.TrimSpace(r.URL.Query().Get("from")), strings.TrimSpace(r.URL.Query().Get("to")), strings.TrimSpace(r.Header.Get("X-User-Id")), strings.TrimSpace(r.Header.Get("X-Mock-Role"))}, ":")
}

func dashboardLLMFingerprint(payload map[string]any) string {
	body, _ := json.Marshal(payload)
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}

func getCachedDashboardLLMSummary(cacheKey string, fingerprint string) *dashboardLLMSummary {
	dashboardLLMCache.Lock()
	defer dashboardLLMCache.Unlock()
	cached, ok := dashboardLLMCache.items[cacheKey]
	if !ok || cached.Fingerprint != fingerprint || cached.Summary == nil {
		return nil
	}
	copy := *cached.Summary
	copy.Cached = true
	copy.CacheKey = shortHash(cacheKey)
	copy.Fingerprint = shortHash(fingerprint)
	return &copy
}

func rememberDashboardLLMSummary(cacheKey string, fingerprint string, summary *dashboardLLMSummary) {
	if summary == nil {
		return
	}
	dashboardLLMCache.Lock()
	defer dashboardLLMCache.Unlock()
	if len(dashboardLLMCache.items) >= dashboardLLMCacheMaxEntries {
		for key := range dashboardLLMCache.items {
			delete(dashboardLLMCache.items, key)
			break
		}
	}
	copy := *summary
	copy.Cached = false
	copy.CacheKey = shortHash(cacheKey)
	copy.Fingerprint = shortHash(fingerprint)
	dashboardLLMCache.items[cacheKey] = cachedDashboardLLMSummary{Fingerprint: fingerprint, Summary: &copy}
}

func summarizeDashboardWithDeepSeek(ctx context.Context, payload map[string]any) (*dashboardLLMSummary, error) {
	apiKey := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY"))
	if apiKey == "" {
		return nil, fmt.Errorf("DEEPSEEK_API_KEY is not configured")
	}
	model := envOr("DEEPSEEK_MODEL", "deepseek-chat")
	baseURL := strings.TrimRight(envOr("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), "/")
	citations := buildDashboardCitations(payload)
	factsJSON, _ := json.Marshal(map[string]any{"dashboard": payload, "citations": citations})

	prompt := fmt.Sprintf(`You summarize a BA manager dashboard. Use ONLY the provided JSON facts. Do not invent names, trends, causes, or recommendations not supported by facts.
Return ONLY compact JSON matching this schema:
{"summary":"one sentence","bullets":[{"text":"grounded bullet","citations":["C1"]}],"citations":[{"id":"C1","label":"...","value":"..."}],"grounded":true}
Rules:
- Every bullet must include at least one citation ID from provided citations.
- Use exact numbers from facts.
- If a conclusion is not supported, omit it.
- Keep to 3-5 bullets.
- Copy provided citations exactly; do not create new citation IDs.

Facts:
%s`, string(factsJSON))

	payloadBody := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": "You write grounded executive dashboard summaries with citations. Return valid JSON only."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.0,
	}
	body, _ := json.Marshal(payloadBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("deepseek status %d", resp.StatusCode)
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}
	if len(decoded.Choices) == 0 {
		return nil, fmt.Errorf("deepseek returned no choices")
	}
	content := strings.TrimSpace(decoded.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	var summary dashboardLLMSummary
	if err := json.Unmarshal([]byte(content), &summary); err != nil {
		return nil, err
	}
	allowed := map[string]dashboardLLMCitation{}
	for _, citation := range citations {
		allowed[citation.ID] = citation
	}
	if len(summary.Bullets) == 0 {
		return nil, fmt.Errorf("summary has no bullets")
	}
	for i := range summary.Bullets {
		summary.Bullets[i].Citations = sanitizeCitationIDs(summary.Bullets[i].Citations, allowed)
		if len(summary.Bullets[i].Citations) == 0 {
			return nil, fmt.Errorf("summary bullet lacks citation")
		}
	}
	summary.Citations = citations
	summary.Provider = "deepseek"
	summary.Grounded = true
	return &summary, nil
}

func buildDashboardCitations(payload map[string]any) []dashboardLLMCitation {
	team := mapValue(payload, "team")
	actions := mapValue(payload, "actions")
	timeframe := mapValue(payload, "timeframe")
	from := valueString(timeframe, "from")
	to := valueString(timeframe, "to")
	return []dashboardLLMCitation{
		{ID: "C1", Label: "Timeframe", Value: fmt.Sprintf("%s to %s", from, to)},
		{ID: "C2", Label: "Team utilization", Value: fmt.Sprintf("%v%% across %v active BA", team["team_utilization_percent"], team["total_ba"])},
		{ID: "C3", Label: "Booked man-days", Value: fmt.Sprintf("%v booked of %v available man-days", team["total_man_days"], team["total_available_man_days"])},
		{ID: "C4", Label: "Pending requests", Value: fmt.Sprintf("%v pending, %v unassigned, %v urgent", actions["pending_requests"], actions["unassigned_requests"], actions["urgent_requests"])},
		{ID: "C5", Label: "Capacity risk", Value: fmt.Sprintf("%v overbooked BA, %v bench BA", actions["overbooked_ba"], actions["bench_ba"])},
	}
}

func buildGroundedDashboardFallback(payload map[string]any, reason string) *dashboardLLMSummary {
	citations := buildDashboardCitations(payload)
	team := mapValue(payload, "team")
	actions := mapValue(payload, "actions")
	return &dashboardLLMSummary{
		Summary:   fmt.Sprintf("Dashboard summary for the selected timeframe: utilization is %v%% with %v pending requests.", team["team_utilization_percent"], actions["pending_requests"]),
		Provider:  "fallback",
		Grounded:  true,
		Reason:    reason,
		Citations: citations,
		Bullets: []dashboardLLMSummaryBullet{
			{Text: fmt.Sprintf("Team utilization is %v%% across %v active BA.", team["team_utilization_percent"], team["total_ba"]), Citations: []string{"C2"}},
			{Text: fmt.Sprintf("The selected period has %v booked man-days out of %v available man-days.", team["total_man_days"], team["total_available_man_days"]), Citations: []string{"C3"}},
			{Text: fmt.Sprintf("There are %v pending requests, including %v unassigned and %v urgent.", actions["pending_requests"], actions["unassigned_requests"], actions["urgent_requests"]), Citations: []string{"C4"}},
			{Text: fmt.Sprintf("Capacity watchlist shows %v overbooked BA and %v bench BA.", actions["overbooked_ba"], actions["bench_ba"]), Citations: []string{"C5"}},
		},
	}
}

func safeDashboardLLMReason(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "LLM summary was unavailable"
	}
	lower := strings.ToLower(message)
	if strings.Contains(lower, "api_key") {
		return "DEEPSEEK_API_KEY is not configured"
	}
	if strings.Contains(lower, "context canceled") {
		return "DeepSeek request was cancelled before completion; retry once after API restart so the detached request can populate cache"
	}
	if strings.Contains(lower, "deadline exceeded") || strings.Contains(lower, "timeout") {
		return "DeepSeek request timed out; check network access to api.deepseek.com or increase DASHBOARD_LLM_TIMEOUT_SECONDS"
	}
	return message
}

func dashboardLLMTimeout() time.Duration {
	value := strings.TrimSpace(os.Getenv("DASHBOARD_LLM_TIMEOUT_SECONDS"))
	if value == "" {
		return 45 * time.Second
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < 1 {
		return 45 * time.Second
	}
	return time.Duration(seconds) * time.Second
}

func sanitizeCitationIDs(ids []string, allowed map[string]dashboardLLMCitation) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if _, ok := allowed[id]; !ok {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func mapValue(input map[string]any, key string) map[string]any {
	switch value := input[key].(type) {
	case map[string]any:
		return value
	case map[string]string:
		out := make(map[string]any, len(value))
		for k, v := range value {
			out[k] = v
		}
		return out
	default:
		return map[string]any{}
	}
}

func valueString(input map[string]any, key string) string {
	if value, ok := input[key]; ok && value != nil {
		return fmt.Sprint(value)
	}
	return "not provided"
}
