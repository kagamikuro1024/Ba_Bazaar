package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
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
}

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
	if strings.TrimSpace(combinedRaw) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "text is required"})
		return
	}

	tags, err := app.fetchActiveSkillTags(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	if response, err := extractSkillTagsWithDeepSeek(ctx, combinedRaw, tags); err == nil {
		writeJSON(w, http.StatusOK, response)
		return
	}

	response := extractSkillTagsHeuristic(combinedRaw, tags)
	writeJSON(w, http.StatusOK, response)
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
	apiKey := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY"))
	if apiKey == "" {
		return nil, fmt.Errorf("DEEPSEEK_API_KEY is not configured")
	}
	model := envOr("DEEPSEEK_MODEL", "deepseek-chat")
	baseURL := strings.TrimRight(envOr("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), "/")

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
- Pick at most 6 tags.
- Pick exactly one suggested_level when the PRD gives enough complexity signal; otherwise use "".
- Level rubric: JUNIOR = simple documentation/clear low-risk work; MIDDLE = normal feature discovery and moderate ambiguity; SENIOR = complex rules, integrations, compliance, payments, reporting, or multi-stakeholder work; LEAD = enterprise-wide strategy, operating-model redesign, or high-risk multi-workstream governance.
- Prefer tags and levels directly supported by the PRD text.

Available tags:
%s

PRD text:
%s`, string(optionsJSON), text)

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": "You extract structured skill tags. Return valid JSON only."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.1,
	}
	body, _ := json.Marshal(payload)
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

	var parsed skillExtractionResponse
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, err
	}
	parsed.Provider = "deepseek"
	parsed.SuggestedTagIDs = sanitizeTagIDs(parsed.SuggestedTagIDs, valid)
	parsed.SuggestedLevel = sanitizeSuggestedLevel(parsed.SuggestedLevel)
	if parsed.Reasoning == nil {
		parsed.Reasoning = []string{}
	}
	return &parsed, nil
}

func extractSkillTagsHeuristic(text string, tags []SkillTag) *skillExtractionResponse {
	combined := strings.ToLower(text)
	type scoredTag struct {
		ID        string
		Name      string
		Score     int
		Reasoning []string
	}
	matches := make([]scoredTag, 0)
	for _, tag := range tags {
		score, reasons := scoreSkillTag(tag, combined)
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
	if len(matches) > 6 {
		matches = matches[:6]
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
	return response
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

func scoreSkillTag(tag SkillTag, corpus string) (int, []string) {
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
	for _, token := range tokens {
		if len(token) < 3 {
			continue
		}
		if strings.Contains(corpus, token) {
			score++
		}
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
