package main

import "net/http"

// handleAdminOverview powers the Admin Dashboard. Phase 1 returns user/role
// counts + the most recent audit activity. AI health (ai_sessions / ai_errors)
// is added in Phase 2 once those tables exist; "ai" stays null until then.
func (app *App) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var total, active, disabled int
	_ = app.DB.Pool.QueryRow(ctx, `select count(*), count(*) filter (where status = 'ACTIVE'), count(*) filter (where status = 'DISABLED') from users`).Scan(&total, &active, &disabled)

	byRole := map[string]int{}
	if rows, err := app.DB.Pool.Query(ctx, `select role::text, count(*) from users group by role`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var role string
			var n int
			if err := rows.Scan(&role, &n); err == nil {
				byRole[role] = n
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"users": map[string]any{
			"total":    total,
			"active":   active,
			"disabled": disabled,
			"by_role":  byRole,
		},
		"recent_audit": app.recentAuditRows(ctx, 8),
		"ai":           nil,
	})
}
