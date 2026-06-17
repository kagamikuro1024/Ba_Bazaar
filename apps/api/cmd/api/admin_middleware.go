package main

import "net/http"

// requireRole guards a chi sub-router so only the given roles may proceed.
// A denied attempt is recorded in audit_logs (action ACCESS_DENIED, result DENIED).
func (app *App) requireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, role := range roles {
		allowed[role] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := app.currentUser(r)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
				return
			}
			if !allowed[user.Role] {
				app.auditAdmin(r, user, "ACCESS_DENIED", "AdminRoute", r.URL.Path, "DENIED", nil, nil)
				writeJSON(w, http.StatusForbidden, map[string]string{"message": "IT Admin role required."})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isITAdminRole(role string) bool { return role == "IT_ADMIN" }
