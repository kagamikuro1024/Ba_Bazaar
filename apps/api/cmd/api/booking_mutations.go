package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

func (app *App) handleBookingUpdate(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"}); return }
	manager := canApproveBooking(user.Role)
	requesterOwns := booking.RequesterID == user.ID
	requesterCanPropose := requesterOwns && user.Role == "PM_PO" && booking.Status != "COMPLETED" && booking.Status != "CANCELLED"
	if !manager && !requesterCanPropose {
		app.createAuditLog(r.Context(), user.ID, "UPDATE_BOOKING", "Booking", booking.ID, "DENIED", nil, nil)
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Only Manager/Admin or requester can propose changes for non-completed, non-cancelled bookings"})
		return
	}
	var input bookingInput
	if err := decodeJSON(r, &input); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"}); return }
	changes, err := app.normalizePartialBookingInput(r.Context(), input)
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	nextBAID := booking.BAID
	if changes.BAID != nil { nextBAID = changes.BAID }
	nextStart := booking.StartDate
	if changes.StartDate != nil { nextStart = *changes.StartDate }
	nextEnd := booking.EndDate
	if changes.EndDate != nil { nextEnd = *changes.EndDate }
	nextCapacity := booking.CapacityPercent
	if changes.CapacityPercent != nil { nextCapacity = *changes.CapacityPercent }
	if nextEnd.Before(nextStart) { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "end_date must be greater than or equal to start_date"}); return }
	if (manager && isOfficialCapacityStatus(booking.Status)) || requesterCanPropose {
		if nextBAID != nil {
			allowed, blockingDay, _ := app.approvalCheck(r.Context(), *nextBAID, nextStart, nextEnd, nextCapacity, booking.ID)
			if !allowed { writeJSON(w, http.StatusBadRequest, map[string]string{"message": fmt.Sprintf("Cannot update booking because capacity exceeds 100%% on %s", blockingDay)}); return }
		}
	}
	if requesterCanPropose {
		pending := changes.toMap()
		pendingJSON, _ := json.Marshal(pending)
		_, err = app.DB.Pool.Exec(r.Context(), `update bookings set pending_changes = $2::jsonb, status = 'PENDING', updated_at = now() where id = $1`, booking.ID, string(pendingJSON))
		if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
		updated, _ := app.bookingByID(r.Context(), booking.ID)
		app.createAuditLog(r.Context(), user.ID, "UPDATE_BOOKING", "Booking", booking.ID, "SUCCESS", booking, updated)
		_ = app.notifyManagers(r.Context(), map[string]any{"id": updated.ID, "title": updated.Title}, "BOOKING_CHANGES_PROPOSED", "Booking changes proposed")
		writeJSON(w, http.StatusOK, updated)
		return
	}
	if err := app.applyBookingChanges(r.Context(), booking.ID, changes, false); err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	updated, _ := app.bookingByID(r.Context(), booking.ID)
	app.createAuditLog(r.Context(), user.ID, "UPDATE_BOOKING", "Booking", booking.ID, "SUCCESS", booking, updated)
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBookingApproveChanges(w http.ResponseWriter, r *http.Request) {
	app.handleBookingApproveChangesCommon(w, r, false)
}

func (app *App) handleBookingApproveFields(w http.ResponseWriter, r *http.Request) {
	app.handleBookingApproveChangesCommon(w, r, true)
}

func (app *App) handleBookingApproveChangesCommon(w http.ResponseWriter, r *http.Request, partial bool) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !canApproveBooking(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to approve booking changes"}); return }
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"}); return }
	pending, err := pendingChangesMap(booking.PendingChanges)
	if err != nil || len(pending) == 0 { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "No pending changes to approve"}); return }
	var input map[string]any
	_ = decodeJSON(r, &input)
	selected := pending
	if partial {
		fields := readStringSlice(input["fields"])
		if len(fields) == 0 { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "No fields specified to approve"}); return }
		overrides, _ := input["overrides"].(map[string]any)
		selected = map[string]any{}
		for _, field := range fields {
			value, ok := pending[field]
			if !ok { writeJSON(w, http.StatusBadRequest, map[string]string{"message": fmt.Sprintf("Field \"%s\" is not in pending changes", field)}); return }
			if overrides != nil {
				if override, exists := overrides[field]; exists { selected[field] = override; continue }
			}
			selected[field] = value
		}
	}
	changes, err := app.partialChangesFromMap(r.Context(), selected)
	if err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()}); return }
	nextBAID := booking.BAID
	if changes.BAID != nil { nextBAID = changes.BAID }
	nextStart := booking.StartDate
	if changes.StartDate != nil { nextStart = *changes.StartDate }
	nextEnd := booking.EndDate
	if changes.EndDate != nil { nextEnd = *changes.EndDate }
	nextCapacity := booking.CapacityPercent
	if changes.CapacityPercent != nil { nextCapacity = *changes.CapacityPercent }
	if nextEnd.Before(nextStart) { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "end_date must be greater than or equal to start_date"}); return }
	if nextBAID != nil {
		allowed, blockingDay, _ := app.approvalCheck(r.Context(), *nextBAID, nextStart, nextEnd, nextCapacity, booking.ID)
		if !allowed { writeJSON(w, http.StatusBadRequest, map[string]string{"message": fmt.Sprintf("Cannot approve booking changes because capacity exceeds 100%% on %s", blockingDay)}); return }
	}
	if err := app.applyBookingChanges(r.Context(), booking.ID, changes, booking.Status == "PENDING"); err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	remaining := map[string]any{}
	for key, value := range pending {
		if _, approved := selected[key]; !approved {
			remaining[key] = value
		}
	}
	if err := app.setPendingChanges(r.Context(), booking.ID, remaining); err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	updated, _ := app.bookingByID(r.Context(), booking.ID)
	action := "APPROVE_BOOKING_CHANGES"
	notifyType := "BOOKING_CHANGES_APPROVED"
	notifyTitle := "Booking changes approved"
	detail := ""
	if partial {
		action = "APPROVE_BOOKING_CHANGES_PARTIAL"
		notifyType = "BOOKING_CHANGES_PARTIALLY_APPROVED"
		notifyTitle = "Booking field changes approved"
		detail = "Approved fields: " + strings.Join(mapKeys(selected), ", ")
	}
	app.createAuditLog(r.Context(), user.ID, action, "Booking", booking.ID, "SUCCESS", booking, updated)
	_ = app.notifyRequester(r.Context(), updated, notifyType, notifyTitle, detail)
	_ = app.notifyAssignedBA(r.Context(), updated, notifyType, notifyTitle, detail)
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBookingRejectChanges(w http.ResponseWriter, r *http.Request) {
	app.handleBookingRejectChangesCommon(w, r, false)
}

func (app *App) handleBookingRejectFields(w http.ResponseWriter, r *http.Request) {
	app.handleBookingRejectChangesCommon(w, r, true)
}

func (app *App) handleBookingRejectChangesCommon(w http.ResponseWriter, r *http.Request, partial bool) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !canApproveBooking(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to reject booking changes"}); return }
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"}); return }
	pending, err := pendingChangesMap(booking.PendingChanges)
	if err != nil || len(pending) == 0 { writeJSON(w, http.StatusBadRequest, map[string]string{"message": ternary(partial, "No pending changes to reject", "No pending changes to reject")}); return }
	var input map[string]any
	_ = decodeJSON(r, &input)
	remaining := map[string]any{}
	detail := ""
	action := "REJECT_BOOKING_CHANGES"
	notifyType := "BOOKING_CHANGES_REJECTED"
	notifyTitle := "Booking changes rejected"
	if partial {
		fields := readStringSlice(input["fields"])
		if len(fields) == 0 { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "No fields specified to reject"}); return }
		fieldSet := map[string]bool{}
		for _, field := range fields { fieldSet[field] = true }
		for key, value := range pending { if !fieldSet[key] { remaining[key] = value } }
		action = "REJECT_BOOKING_CHANGES_PARTIAL"
		notifyType = "BOOKING_CHANGES_PARTIALLY_REJECTED"
		notifyTitle = "Booking field changes rejected"
		detail = "Rejected fields: " + strings.Join(fields, ", ")
	} else {
		reason := strings.TrimSpace(asString(input["reject_reason"]))
		_ = reason
	}
	if err := app.setPendingChanges(r.Context(), booking.ID, remaining); err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	updated, _ := app.bookingByID(r.Context(), booking.ID)
	app.createAuditLog(r.Context(), user.ID, action, "Booking", booking.ID, "SUCCESS", booking, updated)
	_ = app.notifyRequester(r.Context(), updated, notifyType, notifyTitle, detail)
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBookingCancel(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !canApproveBooking(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to cancel bookings"}); return }
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"}); return }
	var input map[string]any
	_ = decodeJSON(r, &input)
	reason := strings.TrimSpace(asString(input["cancel_reason"]))
	if reason == "" { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "cancel_reason is required"}); return }
	today := normalizeDate(time.Now().UTC())
	if !today.Before(normalizeDate(booking.StartDate)) { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Cannot cancel ongoing or completed bookings"}); return }
	if booking.Status != "APPROVED" { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Only approved bookings can be cancelled"}); return }
	updated, err := app.updateBookingStatus(r.Context(), booking.ID, "CANCELLED", nil, nil, &reason)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	app.createAuditLog(r.Context(), user.ID, "CANCEL_BOOKING", "Booking", booking.ID, "SUCCESS", booking, map[string]any{"id": booking.ID, "cancel_reason": reason})
	_ = app.notifyRequester(r.Context(), updated, "BOOKING_CANCELLED", "Booking cancelled", "Reason: "+reason)
	_ = app.notifyAssignedBA(r.Context(), updated, "BOOKING_CANCELLED", "Booking cancelled", "Reason: "+reason)
	writeJSON(w, http.StatusOK, updated)
}

type bookingPartialChanges struct {
	BAID            *string
	ProjectID       *string
	Title           *string
	Description     *string
	Notes           *string
	StartDate       *time.Time
	EndDate         *time.Time
	CapacityPercent *int
	Priority        *string
}

func (b bookingPartialChanges) toMap() map[string]any {
	out := map[string]any{}
	if b.BAID != nil { out["ba_id"] = *b.BAID }
	if b.ProjectID != nil { out["project_id"] = *b.ProjectID }
	if b.Title != nil { out["title"] = *b.Title }
	if b.Description != nil { out["description"] = *b.Description }
	if b.Notes != nil { out["notes"] = *b.Notes } else if b.Notes == nil { }
	if b.StartDate != nil { out["start_date"] = toDateKey(*b.StartDate) }
	if b.EndDate != nil { out["end_date"] = toDateKey(*b.EndDate) }
	if b.CapacityPercent != nil { out["capacity_percent"] = *b.CapacityPercent }
	if b.Priority != nil { out["priority"] = *b.Priority }
	return out
}

func (app *App) normalizePartialBookingInput(ctx context.Context, input bookingInput) (*bookingPartialChanges, error) {
	changes := &bookingPartialChanges{}
	if input.BAID != nil {
		trimmed := strings.TrimSpace(*input.BAID)
		if trimmed == "" { return nil, fmt.Errorf("ba_id is required") }
		ba, err := app.loadBAProfile(ctx, trimmed)
		if err != nil || ba.Status != "ACTIVE" { return nil, fmt.Errorf("Only active BA can be booked") }
		changes.BAID = &trimmed
	}
	if input.ProjectID != nil { trimmed := strings.TrimSpace(*input.ProjectID); if trimmed == "" { return nil, fmt.Errorf("project_id is required") }; changes.ProjectID = &trimmed }
	if input.Title != nil { trimmed := strings.TrimSpace(*input.Title); if trimmed == "" { return nil, fmt.Errorf("title is required") }; changes.Title = &trimmed }
	if input.Description != nil { trimmed := strings.TrimSpace(*input.Description); if trimmed == "" { return nil, fmt.Errorf("description is required") }; changes.Description = &trimmed }
	if input.Notes != nil { note := strings.TrimSpace(*input.Notes); changes.Notes = &note }
	if input.StartDate != nil { parsed, err := parseDateOnly(strings.TrimSpace(*input.StartDate)); if err != nil { return nil, err }; changes.StartDate = &parsed }
	if input.EndDate != nil { parsed, err := parseDateOnly(strings.TrimSpace(*input.EndDate)); if err != nil { return nil, err }; changes.EndDate = &parsed }
	if input.CapacityPercent != nil { if !allowedCapacity(*input.CapacityPercent) { return nil, fmt.Errorf("capacity_percent must be 25, 50, 75, or 100") }; changes.CapacityPercent = input.CapacityPercent }
	if input.Priority != nil { trimmed := strings.TrimSpace(*input.Priority); changes.Priority = &trimmed }
	return changes, nil
}

func (app *App) partialChangesFromMap(ctx context.Context, input map[string]any) (*bookingPartialChanges, error) {
	body := bookingInput{}
	if value, ok := input["ba_id"].(string); ok { body.BAID = &value }
	if value, ok := input["project_id"].(string); ok { body.ProjectID = &value }
	if value, ok := input["title"].(string); ok { body.Title = &value }
	if value, ok := input["description"].(string); ok { body.Description = &value }
	if value, ok := input["notes"].(string); ok { body.Notes = &value }
	if value, ok := input["start_date"].(string); ok { body.StartDate = &value }
	if value, ok := input["end_date"].(string); ok { body.EndDate = &value }
	if value, ok := input["capacity_percent"].(float64); ok { v := int(value); body.CapacityPercent = &v }
	if value, ok := input["capacity_percent"].(int); ok { v := value; body.CapacityPercent = &v }
	if value, ok := input["priority"].(string); ok { body.Priority = &value }
	return app.normalizePartialBookingInput(ctx, body)
}

func (app *App) applyBookingChanges(ctx context.Context, bookingID string, changes *bookingPartialChanges, approvePending bool) error {
	parts := []string{}
	args := []any{bookingID}
	index := 2
	if changes.BAID != nil { parts = append(parts, fmt.Sprintf("ba_id = $%d", index)); args = append(args, *changes.BAID); index++ }
	if changes.ProjectID != nil { parts = append(parts, fmt.Sprintf("project_id = $%d", index)); args = append(args, *changes.ProjectID); index++ }
	if changes.Title != nil { parts = append(parts, fmt.Sprintf("title = $%d", index)); args = append(args, *changes.Title); index++ }
	if changes.Description != nil { parts = append(parts, fmt.Sprintf("description = $%d", index)); args = append(args, *changes.Description); index++ }
	if changes.Notes != nil { parts = append(parts, fmt.Sprintf("notes = $%d", index)); args = append(args, *changes.Notes); index++ }
	if changes.StartDate != nil { parts = append(parts, fmt.Sprintf("start_date = $%d", index)); args = append(args, *changes.StartDate); index++ }
	if changes.EndDate != nil { parts = append(parts, fmt.Sprintf("end_date = $%d", index)); args = append(args, *changes.EndDate); index++ }
	if changes.CapacityPercent != nil { parts = append(parts, fmt.Sprintf("capacity_percent = $%d", index)); args = append(args, *changes.CapacityPercent); index++ }
	if changes.Priority != nil { parts = append(parts, fmt.Sprintf("priority = $%d", index)); args = append(args, *changes.Priority); index++ }
	if approvePending {
		parts = append(parts, fmt.Sprintf("status = $%d", index), fmt.Sprintf("manager_id = $%d", index+1), fmt.Sprintf("approved_at = $%d", index+2), "reject_reason = null", "rejected_at = null")
		args = append(args, "APPROVED", "", time.Now().UTC())
		index += 3
	}
	parts = append(parts, "updated_at = now()")
	if len(parts) == 1 {
		return nil
	}
	_, err := app.DB.Pool.Exec(ctx, `update bookings set `+strings.Join(parts, ", ")+` where id = $1`, args...)
	return err
}

func (app *App) setPendingChanges(ctx context.Context, bookingID string, pending map[string]any) error {
	if len(pending) == 0 {
		_, err := app.DB.Pool.Exec(ctx, `update bookings set pending_changes = null, updated_at = now() where id = $1`, bookingID)
		return err
	}
	encoded, _ := json.Marshal(pending)
	_, err := app.DB.Pool.Exec(ctx, `update bookings set pending_changes = $2::jsonb, updated_at = now() where id = $1`, bookingID, string(encoded))
	return err
}

func pendingChangesMap(value any) (map[string]any, error) {
	if value == nil {
		return nil, nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed, nil
	}
	return nil, fmt.Errorf("invalid pending changes")
}

func readStringSlice(value any) []string {
	if value == nil { return nil }
	raw, ok := value.([]any)
	if !ok { return nil }
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, strings.TrimSpace(text))
		}
	}
	return out
}

func mapKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	return keys
}
