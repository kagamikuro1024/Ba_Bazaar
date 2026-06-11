package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (app *App) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": "ba-bazaar-api",
		})
	})

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", app.handleLogin)
		r.Post("/auth/refresh", app.handleRefresh)
		r.Post("/auth/logout", app.handleLogout)
		r.Get("/auth/me", app.handleMe)
		r.Get("/me", app.handleMe)

		r.Get("/projects", app.handleProjects)
		r.Get("/tags", app.handleTags)
		r.Get("/ba", app.handleBAList)
		r.Post("/ba", app.handleBACreate)
		r.Get("/ba/{id}", app.handleBAByID)
		r.Patch("/ba/{id}", app.handleBAUpdate)
		r.Patch("/ba/{id}/status", app.handleBAChangeStatus)
		r.Get("/ba/{id}/public-card", app.handleBAPublicCard)
		r.Get("/ba/{id}/booking-history", app.handleBAHistory)
		r.Get("/ba/{id}/utilization", app.handleBAUtilization)
		r.Get("/ba/{id}/notes", app.handleBANotes)
		r.Post("/ba/{id}/notes", app.handleBAAppendNote)
		r.Post("/ba/{id}/tags", app.handleBAAddTag)
		r.Delete("/ba/{id}/tags/{tagId}", app.handleBARemoveTag)
		r.Get("/ba/{id}/audit", app.handleBAAudit)
		r.Get("/ba/recommendations", app.handleRecommendations)
		r.Get("/dashboard/manager-summary", app.handleDashboardManagerSummary)
		r.Get("/analytics/team-utilization", app.handleAnalyticsTeamUtilization)
		r.Get("/analytics/project-effort", app.handleAnalyticsProjectEffort)
		r.Get("/reports/utilization", app.handleReportsUtilization)
		r.Get("/reports/utilization.csv", app.handleReportsUtilizationCSV)
		r.Get("/capacity/summary", app.handleCapacitySummary)
		r.Get("/capacity/ba/{baId}", app.handleCapacityBA)
		r.Get("/capacity/range-check", app.handleCapacityRangeCheck)
		r.Get("/notifications", app.handleNotifications)
		r.Post("/notifications/{id}/read", app.handleNotificationRead)
		r.Post("/notifications/reminders/run", app.handleNotificationsRunReminders)
		r.Get("/bookings", app.handleBookingsList)
		r.Post("/bookings/request", app.handleBookingsRequest)
		r.Post("/bookings/direct", app.handleBookingsDirect)
		r.Get("/bookings/my-requests", app.handleBookingsMyRequests)
		r.Get("/bookings/my-schedule", app.handleBookingsMySchedule)
		r.Get("/bookings/{id}", app.handleBookingsGetByID)
		r.Patch("/bookings/{id}", app.handleBookingUpdate)
		r.Post("/bookings/{id}/approve", app.handleBookingsApprove)
		r.Post("/bookings/{id}/reject", app.handleBookingsReject)
		r.Post("/bookings/{id}/changes/approve", app.handleBookingApproveChanges)
		r.Post("/bookings/{id}/changes/reject", app.handleBookingRejectChanges)
		r.Post("/bookings/{id}/changes/approve-fields", app.handleBookingApproveFields)
		r.Post("/bookings/{id}/changes/reject-fields", app.handleBookingRejectFields)
		r.Post("/bookings/{id}/cancel", app.handleBookingCancel)
		r.Patch("/bookings/{id}/assign", app.handleBookingsAssign)
	})

	return r
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-User-Id, X-Mock-Role")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
