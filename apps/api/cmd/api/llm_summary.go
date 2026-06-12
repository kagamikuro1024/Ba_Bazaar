package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// Grounded AI page summaries — shared engine.
//
// Every summarized page (Manager Dashboard, Action Center, Reports, BA
// Schedule) goes through the same pipeline:
//
//   facts -> fingerprint -> cache hit? return cached
//                        -> DeepSeek (citation-checked) or deterministic fallback
//                        -> cache by fingerprint
//
// The fingerprint is a hash of the grounding facts, so the LLM is only
// re-billed when the underlying data actually changes. Page reloads with
// unchanged data are served from the in-memory cache.
// ============================================================================

type llmSummary struct {
	Summary          string               `json:"summary"`
	Bullets          []llmSummaryBullet   `json:"bullets"`
	Citations        []llmCitation        `json:"citations"`
	SuggestedActions []llmSuggestedAction `json:"suggested_actions"`
	Provider         string               `json:"provider"`
	Grounded         bool                 `json:"grounded"`
	Reason           string               `json:"reason,omitempty"`
	Cached           bool                 `json:"cached,omitempty"`
	CacheKey         string               `json:"cache_key,omitempty"`
	Fingerprint      string               `json:"fingerprint,omitempty"`
}

type llmSummaryBullet struct {
	Text      string   `json:"text"`
	Citations []string `json:"citations"`
}

type llmCitation struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Value string `json:"value"`
}

// llmSuggestedAction is computed deterministically on the server from the
// same facts the summary cites. The AI never invents actions and never
// executes them — these are rendered as navigation shortcuts only.
type llmSuggestedAction struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type llmSummarySpec struct {
	// Scope namespaces the cache, e.g. "manager-dashboard".
	Scope string
	// CacheKey identifies one logical view inside the scope (user, range...).
	CacheKey string
	// Facts is the only data the LLM may use.
	Facts map[string]any
	// Citations the LLM must reference; built from Facts.
	Citations []llmCitation
	// Audience/page context line for the prompt.
	Context string
	// Extra per-page rules appended to the prompt.
	Guidance string
	// MaxBullets caps the bullet list (default 5).
	MaxBullets int
	// SuggestedActions computed deterministically from Facts.
	SuggestedActions []llmSuggestedAction
	// Fallback builds a deterministic grounded summary when the LLM is
	// unavailable. Required.
	Fallback func() *llmSummary
}

type cachedLLMSummary struct {
	Fingerprint string
	Summary     *llmSummary
}

var llmSummaryCache = struct {
	sync.Mutex
	items map[string]cachedLLMSummary
}{items: map[string]cachedLLMSummary{}}

const llmSummaryCacheMaxEntries = 200

var (
	citationIDPattern       = regexp.MustCompile(`(?i)\bC\d+\b`)
	citationEvidencePattern = regexp.MustCompile(`(?i)\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?%?\b`)
	citationWordPattern     = regexp.MustCompile(`(?i)\b[a-z][a-z0-9-]{3,}\b`)
)

// serveLLMSummary runs the shared pipeline and writes the JSON response.
func serveLLMSummary(w http.ResponseWriter, spec llmSummarySpec) {
	cacheKey := spec.Scope + ":" + spec.CacheKey
	fingerprint := llmSummaryFingerprint(spec.Facts)

	if cached := getCachedLLMSummary(cacheKey, fingerprint); cached != nil {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), llmSummaryTimeout())
	defer cancel()

	summary, err := summarizeWithDeepSeek(ctx, spec)
	if err != nil {
		summary = spec.Fallback()
		summary.Provider = "fallback"
		summary.Grounded = true
		summary.Reason = safeLLMSummaryReason(err)
		if summary.Citations == nil {
			summary.Citations = spec.Citations
		}
	}
	summary.SuggestedActions = spec.SuggestedActions
	if summary.SuggestedActions == nil {
		summary.SuggestedActions = []llmSuggestedAction{}
	}

	rememberLLMSummary(cacheKey, fingerprint, summary)
	summary.CacheKey = shortHash(cacheKey)
	summary.Fingerprint = shortHash(fingerprint)
	writeJSON(w, http.StatusOK, summary)
}

func llmSummaryFingerprint(payload map[string]any) string {
	body, _ := json.Marshal(payload)
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}

func getCachedLLMSummary(cacheKey string, fingerprint string) *llmSummary {
	llmSummaryCache.Lock()
	defer llmSummaryCache.Unlock()
	cached, ok := llmSummaryCache.items[cacheKey]
	if !ok || cached.Fingerprint != fingerprint || cached.Summary == nil {
		return nil
	}
	copy := *cached.Summary
	copy.Cached = true
	copy.CacheKey = shortHash(cacheKey)
	copy.Fingerprint = shortHash(fingerprint)
	return &copy
}

func rememberLLMSummary(cacheKey string, fingerprint string, summary *llmSummary) {
	if summary == nil {
		return
	}
	llmSummaryCache.Lock()
	defer llmSummaryCache.Unlock()
	if len(llmSummaryCache.items) >= llmSummaryCacheMaxEntries {
		for key := range llmSummaryCache.items {
			delete(llmSummaryCache.items, key)
			break
		}
	}
	copy := *summary
	copy.Cached = false
	llmSummaryCache.items[cacheKey] = cachedLLMSummary{Fingerprint: fingerprint, Summary: &copy}
}

func summarizeWithDeepSeek(ctx context.Context, spec llmSummarySpec) (*llmSummary, error) {
	maxBullets := spec.MaxBullets
	if maxBullets <= 0 {
		maxBullets = 5
	}
	factsJSON, _ := json.Marshal(map[string]any{"facts": spec.Facts, "citations": spec.Citations})

	prompt := fmt.Sprintf(`You summarize this view: %s
Use ONLY the provided JSON facts. Do not invent names, numbers, trends, causes, or recommendations not supported by facts. Never decide for the user — you may point at what needs review first, but do not claim anything was approved, rejected, or assigned.
Return ONLY compact JSON matching this schema:
{"summary":"one or two sentences with the most decision-relevant numbers","bullets":[{"text":"grounded bullet","citations":["C1"]}],"grounded":true}
Rules:
- Every bullet must include at least one citation ID from provided citations.
- Use exact numbers from facts.
- If a conclusion is not supported, omit it.
- Keep to 2-%d bullets, ordered by what the reader should handle first.
- Do not output a citations array; the server attaches citations.
%s
Facts:
%s`, spec.Context, maxBullets, strings.TrimSpace(spec.Guidance), string(factsJSON))

	content, err := callDeepSeekJSON(ctx, deepSeekChatRequest{
		System:      "You write short grounded summaries with citation IDs for a resource-management product. Return valid JSON only.",
		User:        prompt,
		Temperature: 0.0,
		MaxTokens:   700,
	})
	if err != nil {
		return nil, err
	}

	var summary llmSummary
	if err := json.Unmarshal([]byte(content), &summary); err != nil {
		return nil, fmt.Errorf("invalid summary JSON: %w", err)
	}
	return validateLLMSummary(summary, spec, maxBullets)
}

func validateLLMSummary(summary llmSummary, spec llmSummarySpec, maxBullets int) (*llmSummary, error) {
	allowed := map[string]llmCitation{}
	for _, citation := range spec.Citations {
		allowed[citation.ID] = citation
	}
	if len(summary.Bullets) == 0 {
		return nil, fmt.Errorf("summary has no bullets")
	}

	bullets := make([]llmSummaryBullet, 0, maxBullets)
	for _, bullet := range summary.Bullets {
		text := strings.TrimSpace(bullet.Text)
		if text == "" {
			continue
		}
		ids := sanitizeCitationIDs(bullet.Citations, allowed)
		if len(ids) == 0 {
			ids = inferCitationIDsForBullet(text, spec.Citations, allowed)
		}
		if len(ids) == 0 {
			continue
		}
		bullets = append(bullets, llmSummaryBullet{Text: text, Citations: ids})
		if len(bullets) >= maxBullets {
			break
		}
	}
	if len(bullets) == 0 {
		return nil, fmt.Errorf("summary has no cited bullets")
	}

	summary.Summary = strings.TrimSpace(summary.Summary)
	if summary.Summary == "" {
		summary.Summary = "Grounded summary generated from cited facts."
	}
	summary.Bullets = bullets
	summary.Citations = spec.Citations
	summary.Provider = "deepseek"
	summary.Grounded = true
	summary.Reason = ""
	return &summary, nil
}

func safeLLMSummaryReason(err error) string {
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
		return "DeepSeek request was cancelled before completion"
	}
	if strings.Contains(lower, "deadline exceeded") || strings.Contains(lower, "timeout") {
		return "DeepSeek request timed out; check network access to api.deepseek.com or increase DASHBOARD_LLM_TIMEOUT_SECONDS"
	}
	if strings.Contains(lower, "invalid summary json") || strings.Contains(lower, "json content") || strings.Contains(lower, "unexpected end of json input") {
		return "DeepSeek returned invalid JSON; using the cited fallback summary"
	}
	if strings.Contains(lower, "cited bullets") || strings.Contains(lower, "citation") {
		return "DeepSeek response did not pass citation validation; using the cited fallback summary"
	}
	return message
}

func llmSummaryTimeout() time.Duration {
	value := strings.TrimSpace(os.Getenv("LLM_SUMMARY_TIMEOUT_SECONDS"))
	if value == "" {
		value = strings.TrimSpace(os.Getenv("DASHBOARD_LLM_TIMEOUT_SECONDS"))
	}
	if value == "" {
		return 45 * time.Second
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < 1 {
		return 45 * time.Second
	}
	return time.Duration(seconds) * time.Second
}

func sanitizeCitationIDs(ids []string, allowed map[string]llmCitation) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, raw := range ids {
		candidates := citationIDPattern.FindAllString(raw, -1)
		if len(candidates) == 0 {
			candidates = []string{raw}
		}
		for _, id := range candidates {
			id = normalizeCitationID(id)
			if id == "" || seen[id] {
				continue
			}
			if _, ok := allowed[id]; !ok {
				continue
			}
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func normalizeCitationID(id string) string {
	return strings.ToUpper(strings.Trim(strings.TrimSpace(id), "[](){}.,;:#"))
}

func inferCitationIDsForBullet(text string, citations []llmCitation, allowed map[string]llmCitation) []string {
	if ids := sanitizeCitationIDs([]string{text}, allowed); len(ids) > 0 {
		return ids
	}

	lower := strings.ToLower(text)
	bestScore := 0
	scored := make([]struct {
		id    string
		score int
	}, 0, len(citations))
	for _, citation := range citations {
		if _, ok := allowed[citation.ID]; !ok {
			continue
		}
		score := citationEvidenceScore(lower, citation)
		if score == 0 {
			continue
		}
		if score > bestScore {
			bestScore = score
		}
		scored = append(scored, struct {
			id    string
			score int
		}{id: citation.ID, score: score})
	}
	if bestScore < 2 {
		return []string{}
	}

	out := make([]string, 0, 2)
	for _, item := range scored {
		if item.score == bestScore {
			out = append(out, item.id)
			if len(out) == 2 {
				break
			}
		}
	}
	return out
}

func citationEvidenceScore(lowerText string, citation llmCitation) int {
	score := 0
	label := strings.ToLower(strings.TrimSpace(citation.Label))
	if label != "" && strings.Contains(lowerText, label) {
		score += 4
	}

	value := strings.ToLower(citation.Value)
	for _, token := range citationEvidencePattern.FindAllString(value, -1) {
		if lowSignalEvidenceToken(token) {
			continue
		}
		if strings.Contains(lowerText, strings.ToLower(token)) {
			score += 2
		}
	}

	seenWords := map[string]bool{}
	for _, token := range citationWordPattern.FindAllString(label+" "+value, -1) {
		token = strings.ToLower(token)
		if citationStopWord(token) || seenWords[token] {
			continue
		}
		seenWords[token] = true
		if strings.Contains(lowerText, token) {
			score++
		}
	}
	return score
}

func lowSignalEvidenceToken(token string) bool {
	token = strings.TrimSuffix(strings.TrimSpace(token), "%")
	return token == "" || token == "0" || token == "1"
}

func citationStopWord(token string) bool {
	switch token {
	case "with", "from", "that", "this", "then", "than", "into", "onto", "would", "could", "more", "less", "most", "none", "provided":
		return true
	default:
		return false
	}
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
