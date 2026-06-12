package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// Extract Skill from PRD — POST /api/tags/extract
//
// PM/PO pastes PRD text; we suggest required skill tags + BA level.
// Order of attempts:
//   1. In-memory cache (keyed by hash of normalized PRD text + active tag set)
//      so re-clicking "Extract" on the same text never re-bills the LLM.
//   2. DeepSeek with JSON-mode output.
//   3. Deterministic keyword heuristic (always succeeds).
// ============================================================================

const (
	// Hard cap on PRD characters sent to the LLM. Beyond this, extra text
	// rarely changes the suggested tags but always costs tokens.
	tagExtractionMaxInputChars = 8000
	tagExtractionMaxTags       = 6
	tagExtractionMaxReasons    = 6
	tagExtractionCacheMax      = 200
	tagExtractionCacheTTL      = 24 * time.Hour
)

type skillExtractionRequest struct {
	Text        string  `json:"text"`
	ProjectID   *string `json:"project_id"`
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

type skillExtractionResponse struct {
	SuggestedTagIDs []string `json:"suggested_tag_ids"`
	SuggestedLevel  string   `json:"suggested_level"`
	Reasoning       []string `json:"reasoning"`
	Provider        string   `json:"provider"`
	Cached          bool     `json:"cached,omitempty"`
}

type cachedSkillExtraction struct {
	Response  skillExtractionResponse
	ExpiresAt time.Time
}

var tagExtractionCache = struct {
	sync.Mutex
	items map[string]cachedSkillExtraction
}{items: map[string]cachedSkillExtraction{}}

func (app *App) handleTagExtraction(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if user.Role != "PM_PO" && user.Role != "BA_MANAGER" && user.Role != "ADMIN" {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "PM/PO, BA Manager, or Admin role required."})
		return
	}

	var body skillExtractionRequest
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}

	combinedRaw := strings.Join([]string{
		strings.TrimSpace(body.Text),
		strings.TrimSpace(valueOrEmpty(body.Title)),
		strings.TrimSpace(valueOrEmpty(body.Description)),
	}, "\n")
	combinedRaw = strings.TrimSpace(combinedRaw)
	if combinedRaw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "text is required"})
		return
	}
	combinedRaw = truncateForLLM(combinedRaw, tagExtractionMaxInputChars)

	tags, err := app.fetchActiveSkillTags(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	// Cache key covers the PRD text AND the active tag set: if a manager
	// adds/retires tags, old cached suggestions are not reused.
	cacheKey := tagExtractionCacheKey(combinedRaw, tags)
	if cached := getCachedTagExtraction(cacheKey); cached != nil {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	if response, err := extractSkillTagsWithDeepSeek(ctx, combinedRaw, tags); err == nil {
		rememberTagExtraction(cacheKey, *response)
		writeJSON(w, http.StatusOK, response)
		return
	}

	// Heuristic results are cheap; cache them too so the response stays
	// stable, but they will be replaced once the LLM succeeds after a
	// cache expiry.
	response := extractSkillTagsHeuristic(combinedRaw, tags)
	writeJSON(w, http.StatusOK, response)
}

func truncateForLLM(text string, max int) string {
	if len(text) <= max {
		return text
	}
	cut := text[:max]
	// Avoid cutting a multi-byte rune in half.
	for len(cut) > 0 && !isUTF8Start(cut[len(cut)-1]) {
		cut = cut[:len(cut)-1]
	}
	return cut
}

func isUTF8Start(b byte) bool { return b < 0x80 || b >= 0xC0 }

func tagExtractionCacheKey(text string, tags []SkillTag) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(text), " "))
	ids := make([]string, 0, len(tags))
	for _, tag := range tags {
		ids = append(ids, tag.ID)
	}
	sort.Strings(ids)
	sum := sha256.Sum256([]byte(normalized + "|" + strings.Join(ids, ",")))
	return hex.EncodeToString(sum[:])
}

func getCachedTagExtraction(key string) *skillExtractionResponse {
	tagExtractionCache.Lock()
	defer tagExtractionCache.Unlock()
	cached, ok := tagExtractionCache.items[key]
	if !ok {
		return nil
	}
	if time.Now().After(cached.ExpiresAt) {
		delete(tagExtractionCache.items, key)
		return nil
	}
	copy := cached.Response
	copy.Cached = true
	return &copy
}

func rememberTagExtraction(key string, response skillExtractionResponse) {
	tagExtractionCache.Lock()
	defer tagExtractionCache.Unlock()
	if len(tagExtractionCache.items) >= tagExtractionCacheMax {
		for k := range tagExtractionCache.items {
			delete(tagExtractionCache.items, k)
			break
		}
	}
	response.Cached = false
	tagExtractionCache.items[key] = cachedSkillExtraction{Response: response, ExpiresAt: time.Now().Add(tagExtractionCacheTTL)}
}

func (app *App) fetchActiveSkillTags(r *http.Request) ([]SkillTag, error) {
	rows, err := app.DB.Pool.Query(r.Context(), `
		select id, name, "group", status, created_at, updated_at
		from skill_tags
		where status = 'ACTIVE'
		order by "group" asc, name asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]SkillTag, 0)
	for rows.Next() {
		var item SkillTag
		if err := rows.Scan(&item.ID, &item.Name, &item.Group, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func extractSkillTagsWithDeepSeek(ctx context.Context, text string, tags []SkillTag) (*skillExtractionResponse, error) {
	type tagOption struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Group string `json:"group"`
	}
	options := make([]tagOption, 0, len(tags))
	valid := map[string]SkillTag{}
	for _, tag := range tags {
		options = append(options, tagOption{ID: tag.ID, Name: tag.Name, Group: tag.Group})
		valid[tag.ID] = tag
	}
	optionsJSON, _ := json.Marshal(options)

	prompt := fmt.Sprintf(`You are helping a BA staffing product choose required BA skill tags and required BA seniority from PRD text.
Return ONLY compact JSON matching this schema:
{"suggested_tag_ids":["tag-id"],"suggested_level":"JUNIOR|MIDDLE|SENIOR|LEAD|","reasoning":["short reason"]}
Rules:
- Use only tag IDs from the provided tag list.
- Pick at most %d tags, ordered most relevant first.
- Pick exactly one suggested_level when the PRD gives enough complexity signal; otherwise use "".
- Level rubric: JUNIOR = simple documentation/clear low-risk work; MIDDLE = normal feature discovery and moderate ambiguity; SENIOR = complex rules, integrations, compliance, payments, reporting, or multi-stakeholder work; LEAD = enterprise-wide strategy, operating-model redesign, or high-risk multi-workstream governance.
- Each reasoning item must be one short sentence tied to a chosen tag or to the level, max %d items.
- Prefer tags and levels directly supported by the PRD text. Do not invent tags.

Available tags:
%s

PRD text:
%s`, tagExtractionMaxTags, tagExtractionMaxReasons, string(optionsJSON), text)

	content, err := callDeepSeekJSON(ctx, deepSeekChatRequest{
		System:      "You extract structured skill tags. Return valid JSON only.",
		User:        prompt,
		Temperature: 0.1,
		MaxTokens:   600,
	})
	if err != nil {
		return nil, err
	}

	var parsed skillExtractionResponse
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, err
	}
	parsed.Provider = "deepseek"
	parsed.SuggestedTagIDs = sanitizeTagIDs(parsed.SuggestedTagIDs, valid)
	if len(parsed.SuggestedTagIDs) > tagExtractionMaxTags {
		parsed.SuggestedTagIDs = parsed.SuggestedTagIDs[:tagExtractionMaxTags]
	}
	parsed.SuggestedLevel = sanitizeSuggestedLevel(parsed.SuggestedLevel)
	if parsed.Reasoning == nil {
		parsed.Reasoning = []string{}
	}
	if len(parsed.Reasoning) > tagExtractionMaxReasons {
		parsed.Reasoning = parsed.Reasoning[:tagExtractionMaxReasons]
	}
	return &parsed, nil
}

func extractSkillTagsHeuristic(text string, tags []SkillTag) *skillExtractionResponse {
	combined := strings.ToLower(text)
	corpusTokens := tokenSet(combined)
	type scoredTag struct {
		ID        string
		Name      string
		Score     int
		Reasoning []string
	}
	matches := make([]scoredTag, 0)
	for _, tag := range tags {
		score, reasons := scoreSkillTag(tag, combined, corpusTokens)
		if score == 0 {
			continue
		}
		matches = append(matches, scoredTag{ID: tag.ID, Name: tag.Name, Score: score, Reasoning: reasons})
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Score == matches[j].Score {
			return matches[i].Name < matches[j].Name
		}
		return matches[i].Score > matches[j].Score
	})
	if len(matches) > tagExtractionMaxTags {
		matches = matches[:tagExtractionMaxTags]
	}
	response := &skillExtractionResponse{
		SuggestedTagIDs: make([]string, 0, len(matches)),
		SuggestedLevel:  inferSuggestedLevelHeuristic(combined),
		Reasoning:       make([]string, 0, len(matches)),
		Provider:        "heuristic",
	}
	for _, match := range matches {
		response.SuggestedTagIDs = append(response.SuggestedTagIDs, match.ID)
		response.Reasoning = append(response.Reasoning, match.Reasoning...)
	}
	if len(response.Reasoning) > tagExtractionMaxReasons {
		response.Reasoning = response.Reasoning[:tagExtractionMaxReasons]
	}
	return response
}

var tokenSplitPattern = regexp.MustCompile(`[^a-z0-9+#]+`)

// tokenSet splits a lowercase corpus into whole-word tokens so short skill
// tokens like "api" no longer match inside unrelated words ("rapid").
func tokenSet(corpus string) map[string]bool {
	out := map[string]bool{}
	for _, token := range tokenSplitPattern.Split(corpus, -1) {
		if token != "" {
			out[token] = true
		}
	}
	return out
}

func sanitizeTagIDs(ids []string, valid map[string]SkillTag) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if _, ok := valid[id]; !ok {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func inferSuggestedLevelHeuristic(corpus string) string {
	leadTerms := []string{"enterprise-wide", "operating model", "governance", "multi-workstream", "strategy", "executive"}
	seniorTerms := []string{"integration", "api", "compliance", "payment", "refund", "fraud", "audit", "reporting", "escalation", "multi-stakeholder", "complex", "sla"}
	middleTerms := []string{"workflow", "dashboard", "discovery", "user stories", "acceptance criteria", "stakeholder"}
	if containsAny(corpus, leadTerms) {
		return "LEAD"
	}
	if containsAny(corpus, seniorTerms) {
		return "SENIOR"
	}
	if containsAny(corpus, middleTerms) {
		return "MIDDLE"
	}
	return ""
}

func containsAny(corpus string, terms []string) bool {
	for _, term := range terms {
		if strings.Contains(corpus, term) {
			return true
		}
	}
	return false
}

func sanitizeSuggestedLevel(level string) string {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "JUNIOR", "MIDDLE", "SENIOR", "LEAD":
		return strings.ToUpper(strings.TrimSpace(level))
	default:
		return ""
	}
}

func scoreSkillTag(tag SkillTag, corpus string, corpusTokens map[string]bool) (int, []string) {
	name := strings.ToLower(tag.Name)
	tokens := strings.FieldsFunc(name, func(r rune) bool {
		return r == ' ' || r == '-' || r == '/' || r == '(' || r == ')'
	})
	score := 0
	reasons := make([]string, 0, 2)
	if strings.Contains(corpus, name) {
		score += 4
		reasons = append(reasons, "Matched exact skill phrase: "+tag.Name)
	}
	matchedTokens := 0
	for _, token := range tokens {
		if len(token) < 3 {
			continue
		}
		if corpusTokens[token] {
			score++
			matchedTokens++
		}
	}
	// Multi-word tags need more than one stray token in common with the
	// PRD before we suggest them (e.g. "Data Migration" should not fire
	// on the lone word "data").
	if len(reasons) == 0 && len(tokens) > 1 && matchedTokens < 2 {
		return 0, nil
	}
	if score == 0 {
		return 0, nil
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "Matched PRD keywords for "+tag.Name)
	}
	return score, reasons
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (resp skillExtractionResponse) MarshalJSON() ([]byte, error) {
	type alias skillExtractionResponse
	if resp.SuggestedTagIDs == nil {
		resp.SuggestedTagIDs = []string{}
	}
	if resp.Reasoning == nil {
		resp.Reasoning = []string{}
	}
	return json.Marshal(alias(resp))
}
