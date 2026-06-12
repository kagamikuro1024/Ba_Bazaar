package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ============================================================================
// GET /api/reports/summary/llm?month=YYYY-MM
//
// Grounded AI summary for the Reports / Planning page: monthly utilization,
// bench rate, overbook, man-days by project, plus a deterministic forecast of
// what happens to utilization if every pending request is approved.
// Cached by data fingerprint.
// ============================================================================

func (app *App) handleReportsLLMSummary(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canExportReports(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required for reports"})
		return
	}
	_ = app.syncBookingStatuses(r.Context())

	month := strings.TrimSpace(r.URL.Query().Get("month"))
	if month == "" {
		month = time.Now().UTC().Format("2006-01")
	}
	startDate, endDate, err := monthRange(month)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}

	payload, err := app.managerSummaryPayloadForRange(r.Context(), startDate, endDate)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	team := mapValue(payload, "team")
	forecast, err := app.reportsPendingForecast(r.Context(), payload, startDate, endDate)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	facts := map[string]any{
		"month":            month,
		"team":             team,
		"top_projects":     topProjectEffort(payload, 5),
		"watchlist":        dashboardWatchlist(payload),
		"pending_forecast": forecast,
	}
	citations := buildReportsCitations(month, team, payload, forecast)

	serveLLMSummary(w, llmSummarySpec{
		Scope:     "reports",
		CacheKey:  month,
		Facts:     facts,
		Citations: citations,
		Context:   "the Reports / Planning page for one month. The reader is a BA Manager doing resource planning",
		Guidance: `- Cover, in order: monthly team utilization, bench and overbooked BAs, the project consuming the most man-days, then the pending forecast.
- The pending forecast is hypothetical: phrase it as "if all pending requests are approved, utilization is projected to reach X%". Never imply anything has been approved.
- You may name the top project and overbooked/bench BAs exactly as given in facts.`,
		SuggestedActions: reportsSuggestedActions(team, forecast),
		Fallback: func() *llmSummary {
			return buildReportsFallback(month, team, payload, forecast, citations)
		},
	})
}

// reportsPendingForecast estimates the effect of approving every pending
// request in the month: extra man-days, projected utilization, and how many
// currently-safe BAs would tip over 100% (risk_capacity already includes
// pending bookings, so this is a pure projection, not a decision).
func (app *App) reportsPendingForecast(ctx context.Context, payload map[string]any, startDate, endDate time.Time) (map[string]any, error) {
	rows, err := app.DB.Pool.Query(ctx, `
		select id, ba_id, start_date, end_date, capacity_percent, status
		from bookings
		where status = 'PENDING' and start_date <= $2 and end_date >= $1`,
		startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pendingManDays := 0.0
	pendingCount := 0
	for rows.Next() {
		var booking CapacityBooking
		var baID *string
		if err := rows.Scan(&booking.ID, &baID, &booking.StartDate, &booking.EndDate, &booking.CapacityPercent, &booking.Status); err != nil {
			return nil, err
		}
		booking.BAID = baID
		pendingManDays += calculateBookingManDays(booking, startDate, endDate)
		pendingCount++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	team := mapValue(payload, "team")
	bookedManDays := anyToFloat(team["total_man_days"])
	availableManDays := anyToInt(team["total_available_man_days"])
	projected := calculateUtilizationPercent(bookedManDays+pendingManDays, availableManDays)

	// BAs that are fine on approved load but would exceed 100% with pending.
	wouldOverbook := 0
	baRows, _ := payload["ba_utilization"].([]map[string]any)
	for _, row := range baRows {
		approved := anyToInt(row["approved_capacity"])
		risk := anyToInt(row["risk_capacity"])
		if approved <= 100 && risk > 100 {
			wouldOverbook++
		}
	}

	return map[string]any{
		"pending_requests":               pendingCount,
		"pending_man_days":               round1(pendingManDays),
		"current_utilization_percent":    team["team_utilization_percent"],
		"projected_utilization_percent":  projected,
		"ba_that_would_become_overbooked": wouldOverbook,
	}, nil
}

func anyToFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	default:
		return 0
	}
}

func buildReportsCitations(month string, team map[string]any, payload map[string]any, forecast map[string]any) []llmCitation {
	topProject := "none"
	if projects := topProjectEffort(payload, 1); len(projects) > 0 {
		topProject = fmt.Sprintf("%v (%v man-days)", projects[0]["project_name"], projects[0]["man_days"])
	}
	return []llmCitation{
		{ID: "C1", Label: "Month", Value: month},
		{ID: "C2", Label: "Team utilization", Value: fmt.Sprintf("%v%% across %v active BA", team["team_utilization_percent"], team["total_ba"])},
		{ID: "C3", Label: "Bench / overbook", Value: fmt.Sprintf("%v bench BA (%v%% bench rate), %v overbooked BA", team["bench_count"], team["bench_rate_percent"], team["overbooked_count"])},
		{ID: "C4", Label: "Man-days", Value: fmt.Sprintf("%v booked of %v available man-days", team["total_man_days"], team["total_available_man_days"])},
		{ID: "C5", Label: "Top project", Value: topProject},
		{ID: "C6", Label: "Pending forecast", Value: fmt.Sprintf("%v pending requests worth %v man-days; approving all would move utilization from %v%% to %v%% and could overbook %v more BA", forecast["pending_requests"], forecast["pending_man_days"], forecast["current_utilization_percent"], forecast["projected_utilization_percent"], forecast["ba_that_would_become_overbooked"])},
	}
}

func reportsSuggestedActions(team map[string]any, forecast map[string]any) []llmSuggestedAction {
	out := make([]llmSuggestedAction, 0, 4)
	if anyToInt(team["bench_count"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "view_bench", Label: "View bench BAs"})
	}
	if anyToInt(team["overbooked_count"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "check_overbooked", Label: "Check overbooked BAs"})
	}
	out = append(out, llmSuggestedAction{ID: "view_top_projects", Label: "Review top man-day projects"})
	if anyToInt(forecast["pending_requests"]) > 0 {
		out = append(out, llmSuggestedAction{ID: "review_pending", Label: "Review pending before approving"})
	}
	return out
}

func buildReportsFallback(month string, team map[string]any, payload map[string]any, forecast map[string]any, citations []llmCitation) *llmSummary {
	topProject := "no project effort recorded"
	if projects := topProjectEffort(payload, 1); len(projects) > 0 {
		topProject = fmt.Sprintf("%v used %v man-days, the most this month", projects[0]["project_name"], projects[0]["man_days"])
	}
	return &llmSummary{
		Summary:   fmt.Sprintf("In %s the team reached %v%% utilization with %v bench and %v overbooked BA.", month, team["team_utilization_percent"], team["bench_count"], team["overbooked_count"]),
		Citations: citations,
		Bullets: []llmSummaryBullet{
			{Text: fmt.Sprintf("Team utilization is %v%% across %v active BA (%v of %v man-days booked).", team["team_utilization_percent"], team["total_ba"], team["total_man_days"], team["total_available_man_days"]), Citations: []string{"C2", "C4"}},
			{Text: fmt.Sprintf("%v BA are on bench (%v%% bench rate) and %v BA are overbooked.", team["bench_count"], team["bench_rate_percent"], team["overbooked_count"]), Citations: []string{"C3"}},
			{Text: fmt.Sprintf("Top effort: %s.", topProject), Citations: []string{"C5"}},
			{Text: fmt.Sprintf("If all %v pending requests are approved, utilization is projected to move from %v%% to %v%% and %v more BA could become overbooked.", forecast["pending_requests"], forecast["current_utilization_percent"], forecast["projected_utilization_percent"], forecast["ba_that_would_become_overbooked"]), Citations: []string{"C6"}},
		},
	}
}
