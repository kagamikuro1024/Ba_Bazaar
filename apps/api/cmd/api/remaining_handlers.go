package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type capacityExplanationDay struct {
	Date              string `json:"date"`
	ApprovedCapacity  int    `json:"approved_capacity"`
	PendingCapacity   int    `json:"pending_capacity"`
	RiskCapacity      int    `json:"risk_capacity"`
	RequestedCapacity int    `json:"requested_capacity"`
	RiskAfterRequest  int    `json:"risk_after_request"`
	OverflowCapacity  int    `json:"overflow_capacity"`
}

func buildCapacityRangeExplanation(riskDays []capacityExplanationDay) map[string]any {
	approvedStatuses := strings.ToLower("APPROVED") + " + " + strings.ToLower("IN_PROGRESS")
	if len(riskDays) == 0 {
		return map[string]any{
			"risk_level": "SAFE",
			"summary":    "No overbook risk detected for the selected BA and date range.",
			"why_flagged": []string{},
			"signals_used": []string{
				"Daily approved capacity",
				"Daily pending capacity",
				"Requested capacity",
				"Risk formula: " + approvedStatuses + " + pending + requested",
			},
			"suggested_actions": []string{
				"Submit the request as planned.",
				"Keep monitoring pending requests before approval.",
			},
			"risk_days": []capacityExplanationDay{},
		}
	}

	firstRiskDay := riskDays[0]
	maxAfterRequest := 0
	maxOverflow := 0
	for _, day := range riskDays {
		if day.RiskAfterRequest > maxAfterRequest {
			maxAfterRequest = day.RiskAfterRequest
		}
		if day.OverflowCapacity > maxOverflow {
			maxOverflow = day.OverflowCapacity
		}
	}

	actions := []string{
		"Reduce the requested capacity or split the booking across fewer days.",
		"Move the request to dates with lower pending or approved load.",
		"Assign a different BA with more headroom in the same window.",
	}
	if maxOverflow > 25 {
		actions = append(actions, "Review and reject lower-priority pending requests before approving this one.")
	} else {
		actions = append(actions, "Review pending requests and confirm whether they still need the BA.")
	}

	return map[string]any{
		"risk_level": "OVERBOOK_RISK",
		"summary":    fmt.Sprintf("Capacity reaches %d%% once this request is included, peaking on %s.", maxAfterRequest, firstRiskDay.Date),
		"why_flagged": []string{
			fmt.Sprintf("%s already carries %d%% at-risk load before this request.", firstRiskDay.Date, firstRiskDay.RiskCapacity),
			fmt.Sprintf("Adding %d%% pushes the BA to %d%%, which is %d%% over capacity.", firstRiskDay.RequestedCapacity, firstRiskDay.RiskAfterRequest, firstRiskDay.OverflowCapacity),
			"Pending requests are counted so managers can resolve conflicts before approving work.",
		},
		"signals_used": []string{
			"Approved and in-progress bookings on the same BA",
			"Pending requests overlapping the selected date range",
			"Requested capacity for this new booking",
			"Daily overlap by date inside the selected range",
		},
		"suggested_actions": actions,
		"risk_days":          riskDays,
	}
}

func (app *App) handleCapacitySummary(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	_ = app.syncBookingStatuses(r.Context())
	start := strings.TrimSpace(r.URL.Query().Get("start_date"))
	if start == "" { start = "2026-06-01" }
	end := strings.TrimSpace(r.URL.Query().Get("end_date"))
	if end == "" { end = "2026-06-30" }
	startDate, err := parseDateOnly(start)
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	endDate, err := parseDateOnly(end)
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	query := `select id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, status_reason, status_changed_at, created_at, updated_at, version from ba_profiles`
	args := []any{}
	if user.Role == "PM_PO" {
		query += ` where status = 'ACTIVE'`
	}
	rows, err := app.DB.Pool.Query(r.Context(), query, args...)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		ba, err := scanBAProfile(rows)
		if err != nil { continue }
		bookings, _ := app.fetchBookingsForBA(r.Context(), ba.ID, startDate, endDate)
		capRows := make([]CapacityBooking, 0, len(bookings))
		for _, booking := range bookings { capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status}) }
		capacity := getRangeCapacity(capRows, startDate, endDate, "")
		available := 0
		if ba.Status == "ACTIVE" { available = len(workingDaysInRange(startDate, endDate)) }
		booked := round1(calculateBookedWorkingDays(capRows, startDate, endDate))
		items = append(items, map[string]any{"ba_id": ba.ID, "full_name": ba.FullName, "status": ba.Status, "approved_capacity": capacity.MaxApprovedCapacity, "pending_capacity": capacity.MaxPendingCapacity, "risk_capacity": capacity.MaxRiskCapacity, "has_overbook_risk": capacity.HasOverbookRisk, "booked_man_days": booked, "available_man_days": available, "utilization_percent": calculateUtilizationPercent(booked, available), "capacity_label": classifyCapacity(float64(capacity.MaxRiskCapacity))})
	}
	average := 0.0
	for _, item := range items { average += float64(item["approved_capacity"].(int)) }
	if len(items) > 0 { average = round1(average / float64(len(items))) }
	writeJSON(w, http.StatusOK, map[string]any{"start_date": toDateKey(startDate), "end_date": toDateKey(endDate), "average_capacity": average, "counts": map[string]any{"free": countIf(items, func(v map[string]any) bool { return v["approved_capacity"].(int) < 40 }), "working": countIf(items, func(v map[string]any) bool { c := v["approved_capacity"].(int); return c >= 40 && c < 80 }), "near_full": countIf(items, func(v map[string]any) bool { c := v["approved_capacity"].(int); return c >= 80 && c <= 100 }), "overbook": countIf(items, func(v map[string]any) bool { return v["risk_capacity"].(int) > 100 })}, "items": items})
}

func (app *App) handleCapacityBA(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	_ = app.syncBookingStatuses(r.Context())
	baID := chi.URLParam(r, "baId")
	ba, err := app.loadBAProfile(r.Context(), baID)
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "BA not found"}); return }
	if user.Role == "PM_PO" && ba.Status != "ACTIVE" { writeJSON(w, http.StatusForbidden, map[string]string{"message": "PM/PO can only inspect active BA capacity"}); return }
	start := strings.TrimSpace(r.URL.Query().Get("start_date")); if start == "" { start = "2026-06-01" }
	end := strings.TrimSpace(r.URL.Query().Get("end_date")); if end == "" { end = "2026-06-30" }
	startDate, err := parseDateOnly(start); if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	endDate, err := parseDateOnly(end); if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	bookings, _ := app.fetchBookingsForBA(r.Context(), baID, startDate, endDate)
	capRows := make([]CapacityBooking, 0, len(bookings))
	for _, booking := range bookings { capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status}) }
	writeJSON(w, http.StatusOK, map[string]any{"ba_id": baID, "daily": getRangeCapacity(capRows, startDate, endDate, "").Daily, "max_approved_capacity": getRangeCapacity(capRows, startDate, endDate, "").MaxApprovedCapacity, "max_pending_capacity": getRangeCapacity(capRows, startDate, endDate, "").MaxPendingCapacity, "max_risk_capacity": getRangeCapacity(capRows, startDate, endDate, "").MaxRiskCapacity, "has_overbook_risk": getRangeCapacity(capRows, startDate, endDate, "").HasOverbookRisk})
}

func (app *App) handleCapacityRangeCheck(w http.ResponseWriter, r *http.Request) {
	_ = app.syncBookingStatuses(r.Context())
	baID := strings.TrimSpace(r.URL.Query().Get("ba_id"))
	if baID == "" { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "ba_id is required"}); return }
	startDate, err := parseDateOnly(strings.TrimSpace(r.URL.Query().Get("start_date")))
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	endDate, err := parseDateOnly(strings.TrimSpace(r.URL.Query().Get("end_date")))
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	var requested int
	_, err = fmt.Sscanf(strings.TrimSpace(r.URL.Query().Get("capacity_percent")), "%d", &requested)
	if err != nil || !allowedCapacity(requested) { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "capacity_percent must be 25, 50, 75, or 100"}); return }
	bookings, _ := app.fetchBookingsForBA(r.Context(), baID, startDate, endDate)
	capRows := make([]CapacityBooking, 0, len(bookings))
	for _, booking := range bookings { capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status}) }
	capacity := getRangeCapacity(capRows, startDate, endDate, "")
	daily := make([]map[string]any, 0, len(capacity.Daily))
	riskDays := make([]capacityExplanationDay, 0)
	hasRisk := false
	maxRiskAfter := 0
	for _, day := range capacity.Daily {
		riskAfter := day.RiskCapacity + requested
		if riskAfter > maxRiskAfter { maxRiskAfter = riskAfter }
		overflow := 0
		if riskAfter > 100 {
			hasRisk = true
			overflow = riskAfter - 100
			riskDays = append(riskDays, capacityExplanationDay{Date: day.Date, ApprovedCapacity: day.ApprovedCapacity, PendingCapacity: day.PendingCapacity, RiskCapacity: day.RiskCapacity, RequestedCapacity: requested, RiskAfterRequest: riskAfter, OverflowCapacity: overflow})
		}
		daily = append(daily, map[string]any{"date": day.Date, "approved_capacity": day.ApprovedCapacity, "pending_capacity": day.PendingCapacity, "risk_capacity": day.RiskCapacity, "requested_capacity": requested, "risk_after_request": riskAfter})
	}
	writeJSON(w, http.StatusOK, map[string]any{"daily": daily, "max_approved_capacity": capacity.MaxApprovedCapacity, "max_pending_capacity": capacity.MaxPendingCapacity, "max_risk_capacity": capacity.MaxRiskCapacity, "has_overbook_risk": capacity.HasOverbookRisk, "requested_capacity": requested, "max_risk_capacity_after_request": maxRiskAfter, "has_overbook_risk_after_request": hasRisk, "explanation": buildCapacityRangeExplanation(riskDays)})
}

func countIf(items []map[string]any, predicate func(map[string]any) bool) int {
	count := 0
	for _, item := range items {
		if predicate(item) { count++ }
	}
	return count
}

func (app *App) handleNotificationsRunReminders(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	_ = app.syncBookingStatuses(r.Context())
	runDate := strings.TrimSpace(r.URL.Query().Get("date"))
	if runDate == "" { runDate = toDateKey(time.Now().UTC()) }
	parsedRunDate, err := parseDateOnly(runDate)
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	startReminderDate := addDays(parsedRunDate, 3)
	endReminderDate := addDays(parsedRunDate, 1)
	startBookings, _ := app.reminderBookings(r.Context(), "start_date", startReminderDate)
	endBookings, _ := app.reminderBookings(r.Context(), "end_date", endReminderDate)
	created := 0
	created += app.createReminderNotifications(r.Context(), startBookings, "BOOKING_START_REMINDER", "Booking starts in 3 days", func(item reminderBooking) string { return item.Title + "\nStarts on " + toDateKey(item.StartDate) + " for " + item.BAFullName + "." })
	created += app.createReminderNotifications(r.Context(), endBookings, "BOOKING_END_REMINDER", "Booking ends tomorrow", func(item reminderBooking) string { return item.Title + "\nEnds on " + toDateKey(item.EndDate) + " for " + item.BAFullName + "." })
	writeJSON(w, http.StatusOK, map[string]any{"run_date": toDateKey(parsedRunDate), "start_reminder_booking_count": len(startBookings), "end_reminder_booking_count": len(endBookings), "created_notification_count": created})
}

type reminderBooking struct {
	ID          string
	Title       string
	StartDate   time.Time
	EndDate     time.Time
	RequesterID string
	BAUserID    *string
	BAFullName  string
}

func (app *App) reminderBookings(ctx context.Context, column string, day time.Time) ([]reminderBooking, error) {
	query := `select b.id, b.title, b.start_date, b.end_date, b.requester_id, ba.user_id, ba.full_name from bookings b join ba_profiles ba on ba.id = b.ba_id where b.status in ('APPROVED','IN_PROGRESS') and ` + column + ` = $1`
	rows, err := app.DB.Pool.Query(ctx, query, day)
	if err != nil { return nil, err }
	defer rows.Close()
	items := make([]reminderBooking, 0)
	for rows.Next() {
		var item reminderBooking
		var baUserID sql.NullString
		if err := rows.Scan(&item.ID, &item.Title, &item.StartDate, &item.EndDate, &item.RequesterID, &baUserID, &item.BAFullName); err == nil {
			if baUserID.Valid { item.BAUserID = &baUserID.String }
			items = append(items, item)
		}
	}
	return items, rows.Err()
}

func (app *App) createReminderNotifications(ctx context.Context, bookings []reminderBooking, typ, title string, build func(reminderBooking) string) int {
	created := 0
	for _, booking := range bookings {
		recipients := []string{booking.RequesterID}
		if booking.BAUserID != nil { recipients = append(recipients, *booking.BAUserID) }
		for _, recipientID := range recipients {
			var count int
			_ = app.DB.Pool.QueryRow(ctx, `select count(*) from notifications where type = $1 and related_entity_type = 'Booking' and related_entity_id = $2 and recipient_id = $3`, typ, booking.ID, recipientID).Scan(&count)
			if count > 0 { continue }
			_, err := app.DB.Pool.Exec(ctx, `insert into notifications (id, recipient_id, type, title, message, related_entity_type, related_entity_id, created_at) values ($1,$2,$3,$4,$5,'Booking',$6,now())`, newUUID(), recipientID, typ, title, build(booking), booking.ID)
			if err == nil { created++ }
		}
	}
	return created
}
