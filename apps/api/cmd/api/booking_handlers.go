package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func canCreateBookingRequest(role string) bool { return role == "PM_PO" || role == "BA_MANAGER" }
func canCreateDirectBooking(role string) bool  { return role == "BA_MANAGER" }
func canApproveBooking(role string) bool       { return role == "BA_MANAGER" }
func canAssignBooking(role string) bool        { return role == "BA_MANAGER" }

type bookingInput struct {
	BAID             *string  `json:"ba_id"`
	ProjectID        *string  `json:"project_id"`
	ProjectName      *string  `json:"project_name"`
	Title            *string  `json:"title"`
	Description      *string  `json:"description"`
	Notes            *string  `json:"notes"`
	RequiredSkillIDs []string `json:"required_skill_ids"`
	RequiredLevel    *string  `json:"required_level"`
	StartDate        *string  `json:"start_date"`
	EndDate          *string  `json:"end_date"`
	CapacityPercent  *int     `json:"capacity_percent"`
	Priority         *string  `json:"priority"`
	ManagerComment   *string  `json:"manager_comment"`
}

func (app *App) handleBookingsList(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	_ = app.syncBookingStatuses(r.Context())
	query := `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where 1=1`
	args := make([]any, 0)
	index := 1
	if user.Role == "BA" {
		ba, err := app.baProfileByUserID(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA profile not found for current user"})
			return
		}
		query += fmt.Sprintf(" and ba_id = $%d", index)
		args = append(args, ba.ID)
		index++
	}
	if baID := strings.TrimSpace(r.URL.Query().Get("ba_id")); baID != "" {
		query += fmt.Sprintf(" and ba_id = $%d", index)
		args = append(args, baID)
		index++
	}
	if projectID := strings.TrimSpace(r.URL.Query().Get("project_id")); projectID != "" {
		query += fmt.Sprintf(" and project_id = $%d", index)
		args = append(args, projectID)
		index++
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		query += fmt.Sprintf(" and status = $%d", index)
		args = append(args, status)
		index++
	}
	if from := strings.TrimSpace(r.URL.Query().Get("from")); from != "" {
		query += fmt.Sprintf(" and end_date >= $%d", index)
		args = append(args, from)
		index++
	}
	if to := strings.TrimSpace(r.URL.Query().Get("to")); to != "" {
		query += fmt.Sprintf(" and start_date <= $%d", index)
		args = append(args, to)
		index++
	}
	page, pageSize, paginated := parsePagination(r)
	if paginated {
		totalQuery := "select count(*) from (" + query + ") filtered_bookings"
		var total int
		if err := app.DB.Pool.QueryRow(r.Context(), totalQuery, args...).Scan(&total); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		query += fmt.Sprintf(" order by start_date asc, created_at asc limit $%d offset $%d", index, index+1)
		args = append(args, pageSize, (page-1)*pageSize)
		items, err := app.queryBookings(r.Context(), query, args...)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"total":       total,
			"page":        page,
			"page_size":   pageSize,
			"total_pages": totalPages,
		})
		return
	}
	query += ` order by start_date asc, created_at asc`
	items, err := app.queryBookings(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleBookingsGetByID(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	_ = app.syncBookingStatuses(r.Context())
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"})
		return
	}
	if !app.canReadBooking(r.Context(), user, booking) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Cannot read this booking"})
		return
	}
	writeJSON(w, http.StatusOK, booking)
}

func (app *App) handleBookingsRequest(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canCreateBookingRequest(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "PM/PO or Manager role required to create request"})
		return
	}
	var input bookingInput
	if err := decodeJSON(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	normalized, warning, err := app.normalizeBookingInput(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	booking, err := app.insertBooking(r.Context(), normalized, user.ID, nil, "PENDING", nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	_ = app.notifyManagers(r.Context(), map[string]any{"id": booking.ID, "title": booking.Title}, ternary(normalized.BAID != nil, "BOOKING_REQUEST_CREATED", "BOOKING_NEEDS_ASSIGNMENT"), ternary(normalized.BAID != nil, "New booking request", "Booking needs BA assignment"))
	writeJSON(w, http.StatusOK, map[string]any{"booking": booking, "warning": warning})
}

func (app *App) handleBookingsDirect(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canCreateDirectBooking(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to create direct booking"})
		return
	}
	var input bookingInput
	if err := decodeJSON(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	normalized, _, err := app.normalizeBookingInput(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if normalized.BAID == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "BA is required for direct bookings"})
		return
	}
	allowed, blockingDay, _ := app.approvalCheck(r.Context(), *normalized.BAID, normalized.StartDate, normalized.EndDate, normalized.CapacityPercent, "")
	if !allowed {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": fmt.Sprintf("Cannot approve booking because capacity exceeds 100%% on %s", blockingDay)})
		return
	}
	booking, err := app.insertBooking(r.Context(), normalized, user.ID, &user.ID, "APPROVED", input.ManagerComment)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	_ = app.notifyAssignedBA(r.Context(), booking, "BOOKING_APPROVED", "Booking assigned", "")
	writeJSON(w, http.StatusOK, booking)
}

func (app *App) handleBookingsApprove(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canApproveBooking(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to approve booking"})
		return
	}
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"})
		return
	}
	if booking.BAID != nil {
		allowed, blockingDay, _ := app.approvalCheck(r.Context(), *booking.BAID, booking.StartDate, booking.EndDate, booking.CapacityPercent, booking.ID)
		if !allowed {
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": fmt.Sprintf("Cannot approve booking because capacity exceeds 100%% on %s", blockingDay)})
			return
		}
	}
	updated, err := app.updateBookingStatus(r.Context(), booking.ID, "APPROVED", &user.ID, nil, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	_ = app.notifyRequester(r.Context(), updated, "BOOKING_APPROVED", "Booking approved", "")
	_ = app.notifyAssignedBA(r.Context(), updated, "BOOKING_APPROVED", "Booking approved", "")
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBookingsReject(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canApproveBooking(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to reject booking"})
		return
	}
	var body map[string]string
	_ = decodeJSON(r, &body)
	reason := strings.TrimSpace(body["reject_reason"])
	if reason == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "reject_reason is required"})
		return
	}
	updated, err := app.rejectBooking(r.Context(), chi.URLParam(r, "id"), user.ID, reason)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	_ = app.notifyRequester(r.Context(), updated, "BOOKING_REJECTED", "Booking rejected", "Reason: "+reason)
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBookingsAssign(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canAssignBooking(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required to assign booking"})
		return
	}
	var input bookingInput
	if err := decodeJSON(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	if input.BAID == nil || strings.TrimSpace(*input.BAID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "ba_id is required"})
		return
	}
	ba, err := app.loadBAProfile(r.Context(), strings.TrimSpace(*input.BAID))
	if err != nil || ba.Status != "ACTIVE" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Only active BA can be assigned"})
		return
	}
	booking, err := app.bookingByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Booking not found"})
		return
	}
	allowed, blockingDay, _ := app.approvalCheck(r.Context(), ba.ID, booking.StartDate, booking.EndDate, booking.CapacityPercent, booking.ID)
	if !allowed {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": fmt.Sprintf("Cannot assign BA because capacity exceeds 100%% on %s", blockingDay)})
		return
	}
	updated, err := app.assignBooking(r.Context(), booking.ID, ba.ID, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	_ = app.notifyRequester(r.Context(), updated, "BOOKING_ASSIGNED", "BA assigned", "Assigned BA: "+ba.FullName)
	_ = app.notifyAssignedBA(r.Context(), updated, "BOOKING_ASSIGNED", "Booking assigned", "")
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBookingsMyRequests(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if user.Role != "PM_PO" && !canApproveBooking(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "PM/PO or Manager role required"})
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	query := `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where requester_id = $1`
	args := []any{user.ID}
	index := 2
	if status != "" {
		query += fmt.Sprintf(" and status = $%d", index)
		args = append(args, status)
		index++
	}
	page, pageSize, paginated := parsePagination(r)
	if paginated {
		var total int
		if err := app.DB.Pool.QueryRow(r.Context(), "select count(*) from ("+query+") filtered_requests", args...).Scan(&total); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		query += fmt.Sprintf(" order by created_at desc limit $%d offset $%d", index, index+1)
		args = append(args, pageSize, (page-1)*pageSize)
		items, err := app.queryBookings(r.Context(), query, args...)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"total":       total,
			"page":        page,
			"page_size":   pageSize,
			"total_pages": totalPages,
		})
		return
	}
	query += ` order by created_at desc`
	items, err := app.queryBookings(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleBookingsMySchedule(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	ba, err := app.baProfileByUserID(r.Context(), user.ID)
	if err != nil {
		if canApproveBooking(user.Role) {
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA profile not found for current user"})
		return
	}
	items, err := app.queryBookings(r.Context(), `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where ba_id = $1 and status in ('APPROVED','IN_PROGRESS','COMPLETED') order by start_date asc`, ba.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	page, pageSize, paginated := parsePagination(r)
	if paginated {
		var total int
		if err := app.DB.Pool.QueryRow(r.Context(), `select count(*) from bookings where ba_id = $1 and status in ('APPROVED','IN_PROGRESS','COMPLETED')`, ba.ID).Scan(&total); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		paged, err := app.queryBookings(r.Context(), `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where ba_id = $1 and status in ('APPROVED','IN_PROGRESS','COMPLETED') order by start_date asc limit $2 offset $3`, ba.ID, pageSize, (page-1)*pageSize)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       paged,
			"total":       total,
			"page":        page,
			"page_size":   pageSize,
			"total_pages": totalPages,
		})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) queryBookings(ctx context.Context, query string, args ...any) ([]Booking, error) {
	rows, err := app.DB.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Booking, 0)
	for rows.Next() {
		booking, err := scanBooking(rows)
		if err != nil {
			return nil, err
		}
		if booking.BAID != nil {
			if ba, err := app.loadBAProfile(ctx, *booking.BAID); err == nil {
				booking.BA = ba
			}
		}
		if project, err := app.loadProject(ctx, booking.ProjectID); err == nil {
			booking.Project = project
		}
		if requester, err := app.findUserByID(ctx, booking.RequesterID); err == nil {
			booking.Requester = requester
		}
		if booking.ManagerID != nil {
			if manager, err := app.findUserByID(ctx, *booking.ManagerID); err == nil {
				booking.Manager = manager
			}
		}
		items = append(items, *booking)
	}
	return items, rows.Err()
}

func (app *App) bookingByID(ctx context.Context, id string) (*Booking, error) {
	items, err := app.queryBookings(ctx, `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where id = $1`, id)
	if err != nil || len(items) == 0 {
		return nil, fmt.Errorf("booking not found")
	}
	return &items[0], nil
}

func (app *App) baProfileByUserID(ctx context.Context, userID string) (*BAProfile, error) {
	row := app.DB.Pool.QueryRow(ctx, `select id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, status_reason, status_changed_at, created_at, updated_at, version from ba_profiles where user_id = $1 limit 1`, userID)
	return scanBAProfile(row)
}

func (app *App) canReadBooking(ctx context.Context, user *User, booking *Booking) bool {
	if canApproveBooking(user.Role) || booking.RequesterID == user.ID {
		return true
	}
	if user.Role == "BA" && booking.BAID != nil {
		if ba, err := app.baProfileByUserID(ctx, user.ID); err == nil && ba.ID == *booking.BAID {
			return true
		}
	}
	return false
}

func (app *App) normalizeBookingInput(ctx context.Context, input bookingInput) (*bookingInputNormalized, map[string]any, error) {
	var baID *string
	if input.BAID != nil && strings.TrimSpace(*input.BAID) != "" {
		trimmed := strings.TrimSpace(*input.BAID)
		ba, err := app.loadBAProfile(ctx, trimmed)
		if err != nil || ba.Status != "ACTIVE" {
			return nil, nil, fmt.Errorf("Only active BA can be booked")
		}
		baID = &trimmed
	}
	if input.StartDate == nil || input.EndDate == nil {
		return nil, nil, fmt.Errorf("start_date and end_date are required")
	}
	startDate, err := parseDateOnly(strings.TrimSpace(*input.StartDate))
	if err != nil {
		return nil, nil, err
	}
	endDate, err := parseDateOnly(strings.TrimSpace(*input.EndDate))
	if err != nil {
		return nil, nil, err
	}
	if endDate.Before(startDate) {
		return nil, nil, fmt.Errorf("end_date must be greater than or equal to start_date")
	}
	projectID := ""
	if input.ProjectID != nil && strings.TrimSpace(*input.ProjectID) != "" {
		projectID = strings.TrimSpace(*input.ProjectID)
	} else if input.ProjectName != nil && strings.TrimSpace(*input.ProjectName) != "" {
		projectID, err = app.findOrCreateProjectID(ctx, strings.TrimSpace(*input.ProjectName))
		if err != nil {
			return nil, nil, err
		}
	} else {
		return nil, nil, fmt.Errorf("project_id or project_name is required")
	}
	if input.Title == nil || strings.TrimSpace(*input.Title) == "" {
		return nil, nil, fmt.Errorf("title is required")
	}
	if input.Description == nil || strings.TrimSpace(*input.Description) == "" {
		return nil, nil, fmt.Errorf("description is required")
	}
	if input.CapacityPercent == nil || !allowedCapacity(*input.CapacityPercent) {
		return nil, nil, fmt.Errorf("capacity_percent must be 25, 50, 75, or 100")
	}
	priority := "MEDIUM"
	if input.Priority != nil && strings.TrimSpace(*input.Priority) != "" {
		priority = strings.TrimSpace(*input.Priority)
	}
	requiredLevel := ""
	if input.RequiredLevel != nil {
		requiredLevel = sanitizeSuggestedLevel(*input.RequiredLevel)
	}
	normalized := &bookingInputNormalized{BAID: baID, ProjectID: projectID, Title: strings.TrimSpace(*input.Title), Description: strings.TrimSpace(*input.Description), Notes: trimStringPtr(input.Notes), RequiredSkillIDs: ParseSkillIDsFromSlice(input.RequiredSkillIDs), RequiredLevel: requiredLevel, StartDate: startDate, EndDate: endDate, CapacityPercent: *input.CapacityPercent, Priority: priority}
	warning := map[string]any(nil)
	if baID != nil {
		warning = app.submitWarning(ctx, *baID, startDate, endDate, *input.CapacityPercent)
	}
	return normalized, warning, nil
}

type bookingInputNormalized struct {
	BAID             *string
	ProjectID        string
	Title            string
	Description      string
	Notes            *string
	RequiredSkillIDs []string
	RequiredLevel    string
	StartDate        time.Time
	EndDate          time.Time
	CapacityPercent  int
	Priority         string
}

func allowedCapacity(value int) bool {
	return value == 25 || value == 50 || value == 75 || value == 100
}
func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func (app *App) findOrCreateProjectID(ctx context.Context, name string) (string, error) {
	var id string
	err := app.DB.Pool.QueryRow(ctx, `select id from projects where lower(name) = lower($1) limit 1`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	id = newUUID()
	_, err = app.DB.Pool.Exec(ctx, `insert into projects (id, name, color, description, created_at, updated_at) values ($1, $2, '#2563EB', 'Created from booking request', now(), now())`, id, name)
	return id, err
}

func (app *App) submitWarning(ctx context.Context, baID string, startDate, endDate time.Time, capacity int) map[string]any {
	bookings, _ := app.fetchBookingsForBA(ctx, baID, startDate, endDate)
	capRows := make([]CapacityBooking, 0, len(bookings))
	for _, booking := range bookings {
		capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
	}
	rangeCapacity := getRangeCapacity(capRows, startDate, endDate, "")
	for _, day := range rangeCapacity.Daily {
		risk := day.ApprovedCapacity + day.PendingCapacity + capacity
		if risk > 100 {
			return map[string]any{"type": "OVERBOOK_RISK", "message": "BA has overbook risk in selected date range.", "date": day.Date, "approved_capacity": day.ApprovedCapacity, "pending_capacity": day.PendingCapacity, "requested_capacity": capacity, "risk_capacity": risk}
		}
	}
	return nil
}

func (app *App) approvalCheck(ctx context.Context, baID string, startDate, endDate time.Time, capacity int, excludeBookingID string) (bool, string, int) {
	bookings, _ := app.fetchBookingsForBA(ctx, baID, startDate, endDate)
	capRows := make([]CapacityBooking, 0, len(bookings))
	for _, booking := range bookings {
		capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
	}
	return canApproveCapacity(capRows, startDate, endDate, capacity, excludeBookingID)
}

func (app *App) insertBooking(ctx context.Context, input *bookingInputNormalized, requesterID string, managerID *string, status string, managerComment *string) (*Booking, error) {
	id := newUUID()
	approvedAt := any(nil)
	if status == "APPROVED" {
		approvedAt = time.Now().UTC()
	}
	// Booking requirements (skills/level) ride along in pending_changes so
	// the manager's AI Suggest can score against them. They are metadata,
	// not "proposed changes" — the web client filters them out of the
	// change-review UI (see REQUIREMENT_METADATA_KEYS).
	requirementChanges := map[string]any{}
	if len(input.RequiredSkillIDs) > 0 {
		requirementChanges["required_skill_ids"] = input.RequiredSkillIDs
	}
	if input.RequiredLevel != "" {
		requirementChanges["required_level"] = input.RequiredLevel
	}
	pendingChanges := any(nil)
	if len(requirementChanges) > 0 {
		pendingChanges = requirementChanges
	}
	_, err := app.DB.Pool.Exec(ctx, `insert into bookings (id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, manager_comment, approved_at, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())`, id, nullableString(input.BAID), input.ProjectID, requesterID, nullableString(managerID), input.Title, input.Description, nullableString(input.Notes), pendingChanges, input.StartDate, input.EndDate, input.CapacityPercent, input.Priority, status, nullableString(managerComment), approvedAt)
	if err != nil {
		return nil, err
	}
	return app.bookingByID(ctx, id)
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func (app *App) updateBookingStatus(ctx context.Context, id, status string, managerID *string, rejectReason *string, cancelReason *string) (*Booking, error) {
	changes := []string{"status = $2", "pending_changes = null", "updated_at = now()"}
	args := []any{id, status}
	index := 3
	if managerID != nil && strings.TrimSpace(*managerID) != "" {
		changes = append(changes, fmt.Sprintf("manager_id = $%d", index))
		args = append(args, strings.TrimSpace(*managerID))
		index++
	}
	if status == "APPROVED" {
		changes = append(changes, "approved_at = now()", "reject_reason = null", "rejected_at = null")
	}
	if status == "REJECTED" {
		changes = append(changes, "rejected_at = now()")
		changes = append(changes, fmt.Sprintf("reject_reason = $%d", index))
		args = append(args, nullableString(rejectReason))
		index++
	}
	if status == "CANCELLED" {
		changes = append(changes, "cancelled_at = now()")
		changes = append(changes, fmt.Sprintf("cancel_reason = $%d", index))
		args = append(args, nullableString(cancelReason))
		index++
	}
	_, err := app.DB.Pool.Exec(ctx, `update bookings set `+strings.Join(changes, ", ")+` where id = $1`, args...)
	if err != nil {
		return nil, err
	}
	return app.bookingByID(ctx, id)
}

func (app *App) rejectBooking(ctx context.Context, id, managerID, reason string) (*Booking, error) {
	return app.updateBookingStatus(ctx, id, "REJECTED", &managerID, &reason, nil)
}

func (app *App) assignBooking(ctx context.Context, id, baID, managerID string) (*Booking, error) {
	_, err := app.DB.Pool.Exec(ctx, `update bookings set ba_id = $2, manager_id = $3, updated_at = now() where id = $1`, id, baID, managerID)
	if err != nil {
		return nil, err
	}
	return app.bookingByID(ctx, id)
}

func (app *App) notifyManagers(ctx context.Context, booking map[string]any, typ, title string) error {
	rows, err := app.DB.Pool.Query(ctx, `select id from users where role = 'BA_MANAGER'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			_, _ = app.DB.Pool.Exec(ctx, `insert into notifications (id, recipient_id, type, title, message, related_entity_type, related_entity_id, created_at) values ($1,$2,$3,$4,$5,'Booking',$6,now())`, newUUID(), id, typ, title, fmt.Sprint(booking["title"]), fmt.Sprint(booking["id"]))
		}
	}
	return nil
}

func (app *App) notifyRequester(ctx context.Context, booking *Booking, typ, title, detail string) error {
	message := booking.Title
	if detail != "" {
		message = booking.Title + "\n" + detail
	}
	_, err := app.DB.Pool.Exec(ctx, `insert into notifications (id, recipient_id, type, title, message, related_entity_type, related_entity_id, created_at) values ($1,$2,$3,$4,$5,'Booking',$6,now())`, newUUID(), booking.RequesterID, typ, title, message, booking.ID)
	return err
}

func (app *App) notifyAssignedBA(ctx context.Context, booking *Booking, typ, title, detail string) error {
	if booking.BAID == nil {
		return nil
	}
	var userID sql.NullString
	if err := app.DB.Pool.QueryRow(ctx, `select user_id from ba_profiles where id = $1`, *booking.BAID).Scan(&userID); err != nil || !userID.Valid {
		return nil
	}
	message := booking.Title
	if detail != "" {
		message = booking.Title + "\n" + detail
	}
	_, err := app.DB.Pool.Exec(ctx, `insert into notifications (id, recipient_id, type, title, message, related_entity_type, related_entity_id, created_at) values ($1,$2,$3,$4,$5,'Booking',$6,now())`, newUUID(), userID.String, typ, title, message, booking.ID)
	return err
}

func newUUID() string {
	return uuid.NewString()
}

func ternary[T any](condition bool, ifTrue T, ifFalse T) T {
	if condition {
		return ifTrue
	}
	return ifFalse
}
