package main

import (
	"fmt"
	"net/http"
	"strings"
)

// ============================================================================
// GET /api/dashboard/manager-summary/llm
//
// Grounded AI summary for the BA Manager dashboard. Answers "what should the
// manager handle first in the next 30 seconds": utilization, pending/urgent/
// unassigned requests, overbooked and bench BAs — with suggested next actions.
// Cached by data fingerprint (see llm_summary.go).
// ============================================================================

func (app *App) handleDashboardManagerLLMSummary(w http.ResponseWriter, r *http.Request) {
	payload, status, err := app.managerSummaryPayload(r)
	if err != nil {
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}

	team := mapValue(payload, "team")
	actions := mapValue(payload, "actions")
	timeframe := mapValue(payload, "timeframe")

	// Slim facts: the LLM does not need every BA row, only the watchlist.
	facts := map[string]any{
		"timeframe":             timeframe,
		"team":                  team,
		"actions":               actions,
		"capacity_distribution": payload["capacity_distribution"],
		"watchlist":             dashboardWatchlist(payload),
		"top_projects":          topProjectEffort(payload, 3),
	}

	citations := buildDashboardCitations(payload)

	serveLLMSummary(w, llmSummarySpec{
		Scope:    "manager-dashboard",
		CacheKey: strings.Join([]string{valueString(timeframe, "from"), valueString(timeframe, "to")}, ":"),
		Facts:    facts,
		Citations: citations,
		Context:  "the BA Manager dashboard. The reader is a BA Manager deciding what to handle first this period",
		Guidance: `- Lead with the request queue (urgent and unassigned first), then capacity risks (overbooked BAs), then utilization/bench.
- If watchlist names exist, you may name the overbooked or bench BAs exactly as given.
- Close with what to review first, phrased as a suggestion ("review", "consider"), never as a decision.`,
		SuggestedActions: dashboardSuggestedActions(actions),
		Fallback: func() *llmSummary {
			return buildGroundedDashboardFallback(payload)
		},
	})
}

// dashboardWatchlist projects the heavy ba_utilization rows down to the few
// names the summary may mention: overbooked and bench BAs.
func dashboardWatchlist(payload map[string]any) map[string]any {
	overbooked := make([]map[string]any, 0, 4)
	bench := make([]map[string]any, 0, 4)
	rows, _ := payload["ba_utilization"].([]map[string]any)
	for _, row := range rows {
		label, _ := row["capacity_label"].(string)
		entry := map[string]any{
			"ba_name":             row["ba_name"],
			"utilization_percent": row["utilization_percent"],
			"risk_capacity":       row["risk_capacity"],
		}
		switch label {
		case "OVERBOOKED":
			if len(overbooked) < 4 {
				overbooked = append(overbooked, entry)
			}
		case "BENCH":
			if len(bench) < 4 {
				bench = append(bench, entry)
			}
		}
	}
	return map[string]any{"overbooked_bas": overbooked, "bench_bas": bench}
}

func topProjectEffort(payload map[string]any, limit int) []map[string]any {
	rows, _ := payload["project_effort"].([]map[string]any)
	out := make([]map[string]any, 0, limit)
	for _, row := range rows {
		if len(out) >= limit {
			break
		}
		out = append(out, map[string]any{
			"project_name": row["project_name"],
			"man_days":     row["man_days"],
		})
	}
	return out
}

func dashboardSuggestedActions(actions map[string]any) []llmSuggestedAction {
	out := make([]llmSuggestedAction, 0, 4)
	if anyToInt(actions["urgent_requests"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "review_urgent", Label: "Review urgent requests"})
	}
	if anyToInt(actions["unassigned_requests"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "assign_open", Label: "Assign open requests"})
	}
	if anyToInt(actions["pending_requests"]) > 0 && anyToInt(actions["urgent_requests"]) == 0 {
		out = append(out, llmSuggestedAction{ID: "review_pending", Label: "Review pending requests"})
	}
	if anyToInt(actions["overbooked_ba"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "check_overbooked", Label: "Check overbooked BAs"})
	}
	if anyToInt(actions["bench_ba"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "view_bench", Label: "View bench BAs"})
	}
	return out
}

func anyToInt(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return 0
	}
}

func buildDashboardCitations(payload map[string]any) []llmCitation {
	team := mapValue(payload, "team")
	actions := mapValue(payload, "actions")
	timeframe := mapValue(payload, "timeframe")
	from := valueString(timeframe, "from")
	to := valueString(timeframe, "to")
	return []llmCitation{
		{ID: "C1", Label: "Timeframe", Value: fmt.Sprintf("%s to %s", from, to)},
		{ID: "C2", Label: "Team utilization", Value: fmt.Sprintf("%v%% across %v active BA", team["team_utilization_percent"], team["total_ba"])},
		{ID: "C3", Label: "Booked man-days", Value: fmt.Sprintf("%v booked of %v available man-days", team["total_man_days"], team["total_available_man_days"])},
		{ID: "C4", Label: "Pending requests", Value: fmt.Sprintf("%v pending, %v unassigned, %v urgent", actions["pending_requests"], actions["unassigned_requests"], actions["urgent_requests"])},
		{ID: "C5", Label: "Capacity risk", Value: fmt.Sprintf("%v overbooked BA, %v bench BA", actions["overbooked_ba"], actions["bench_ba"])},
	}
}

func buildGroundedDashboardFallback(payload map[string]any) *llmSummary {
	citations := buildDashboardCitations(payload)
	team := mapValue(payload, "team")
	actions := mapValue(payload, "actions")
	return &llmSummary{
		Summary:   fmt.Sprintf("Team utilization is %v%% with %v pending requests (%v urgent, %v unassigned).", team["team_utilization_percent"], actions["pending_requests"], actions["urgent_requests"], actions["unassigned_requests"]),
		Citations: citations,
		Bullets: []llmSummaryBullet{
			{Text: fmt.Sprintf("There are %v pending requests, including %v unassigned and %v urgent.", actions["pending_requests"], actions["unassigned_requests"], actions["urgent_requests"]), Citations: []string{"C4"}},
			{Text: fmt.Sprintf("Capacity watchlist shows %v overbooked BA and %v bench BA.", actions["overbooked_ba"], actions["bench_ba"]), Citations: []string{"C5"}},
			{Text: fmt.Sprintf("Team utilization is %v%% across %v active BA.", team["team_utilization_percent"], team["total_ba"]), Citations: []string{"C2"}},
			{Text: fmt.Sprintf("The selected period has %v booked man-days out of %v available man-days.", team["total_man_days"], team["total_available_man_days"]), Citations: []string{"C3"}},
		},
	}
}
