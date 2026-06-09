package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

func isManagerRole(role string) bool { return role == "BA_MANAGER" }
func isAdminSupportRole(role string) bool { return role == "ADMIN" }
func canViewPrivateBAFields(role string) bool { return isManagerRole(role) || isAdminSupportRole(role) }
func canReadPrivateNotes(role string) bool { return isManagerRole(role) || isAdminSupportRole(role) }

func (app *App) handleBAList(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	_ = app.syncBookingStatuses(r.Context())

	from := strings.TrimSpace(r.URL.Query().Get("from"))
	to := strings.TrimSpace(r.URL.Query().Get("to"))
	startDate, endDate, err := resolveTimeframe(from, to)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	workingDays := len(workingDaysInRange(startDate, endDate))

	query := `select id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, status_reason, status_changed_at, created_at, updated_at, version from ba_profiles where 1=1`
	args := make([]any, 0)
	index := 1
	if user.Role == "PM_PO" || r.URL.Query().Get("bookable") == "true" {
		query += fmt.Sprintf(" and status = $%d", index)
		args = append(args, "ACTIVE")
		index++
	}
	if user.Role == "BA" {
		query += fmt.Sprintf(" and user_id = $%d and status <> $%d", index, index+1)
		args = append(args, user.ID, "RESIGNED")
		index += 2
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" && canViewPrivateBAFields(user.Role) {
		query += fmt.Sprintf(" and status = $%d", index)
		args = append(args, status)
		index++
	}
	if level := strings.TrimSpace(r.URL.Query().Get("level")); level != "" {
		query += fmt.Sprintf(" and level = $%d", index)
		args = append(args, level)
		index++
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if search == "" {
		search = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	if search != "" {
		query += fmt.Sprintf(" and (full_name ilike $%d or email ilike $%d)", index, index+1)
		args = append(args, "%"+search+"%", "%"+search+"%")
		index += 2
	}
	query += " order by status asc, full_name asc"

	rows, err := app.DB.Pool.Query(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]BAListItem, 0)
	for rows.Next() {
		ba, err := scanBAProfile(rows)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		tags, _ := fetchSkillTagsForBA(app.DB.Pool, ba.ID)
		ba.SkillTags = tags
		bookings, _ := app.fetchBookingsForBA(r.Context(), ba.ID, startDate, endDate)
		capRows := make([]CapacityBooking, 0, len(bookings))
		for _, booking := range bookings {
			capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
		}
		capacity := getRangeCapacity(capRows, startDate, endDate, "")
		availableDays := 0
		if ba.Status == "ACTIVE" {
			availableDays = workingDays
		}
		bookedDays := round1(calculateBookedWorkingDays(capRows, startDate, endDate))
		utilization := calculateUtilizationPercent(bookedDays, availableDays)
		label := classifyCapacity(utilization)
		if capacity.MaxRiskCapacity > 100 {
			label = "OVERBOOKED"
		}
		items = append(items, BAListItem{
			BAProfile:           *ba,
			Timeframe:           map[string]string{"from": toDateKey(startDate), "to": toDateKey(endDate)},
			ApprovedCapacity:    capacity.MaxApprovedCapacity,
			PendingCapacity:     capacity.MaxPendingCapacity,
			RiskCapacity:        capacity.MaxRiskCapacity,
			BookedManDays:       bookedDays,
			AvailableManDays:    availableDays,
			UtilizationPercent:  utilization,
			CapacityLabel:       label,
			CurrentProjects:     summarizeCurrentProjects(bookings),
		})
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleBAByID(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	ba, err := app.loadBAProfile(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "BA profile not found"})
		return
	}
	if user.Role == "PM_PO" && ba.Status != "ACTIVE" {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "PM/PO can only view active BA public profiles"})
		return
	}
	if user.Role == "BA" && (ba.UserID == nil || *ba.UserID != user.ID) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA can only view own profile"})
		return
	}
	if !canViewPrivateBAFields(user.Role) {
		writeJSON(w, http.StatusOK, toPublicProfile(ba))
		return
	}
	writeJSON(w, http.StatusOK, ba)
}

func (app *App) handleBAPublicCard(w http.ResponseWriter, r *http.Request) {
	ba, err := app.loadBAProfile(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "BA profile not found"})
		return
	}
	writeJSON(w, http.StatusOK, toPublicProfile(ba))
}

func (app *App) handleBAUtilization(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	ba, err := app.loadBAProfile(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "BA profile not found"})
		return
	}
	if user.Role == "BA" && (ba.UserID == nil || *ba.UserID != user.ID) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA can only view own profile"})
		return
	}
	month := strings.TrimSpace(r.URL.Query().Get("month"))
	from := strings.TrimSpace(r.URL.Query().Get("from"))
	to := strings.TrimSpace(r.URL.Query().Get("to"))
	var startDate, endDate time.Time
	if from != "" || to != "" {
		startDate, endDate, err = resolveTimeframe(from, to)
	} else {
		if month == "" {
			month = time.Now().UTC().Format("2006-01")
		}
		startDate, endDate, err = monthRange(month)
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	bookings, _ := app.fetchBookingsForBA(r.Context(), ba.ID, startDate, endDate)
	capRows := make([]CapacityBooking, 0, len(bookings))
	for _, booking := range bookings {
		capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
	}
	workingDays := len(workingDaysInRange(startDate, endDate))
	bookedDays := round1(calculateBookedWorkingDays(capRows, startDate, endDate))
	writeJSON(w, http.StatusOK, map[string]any{
		"ba_id":                ba.ID,
		"period":               month,
		"start_date":           toDateKey(startDate),
		"end_date":             toDateKey(endDate),
		"working_days":         workingDays,
		"booked_days":          bookedDays,
		"utilization_percent":  calculateUtilizationPercent(bookedDays, workingDays),
	})
}

func (app *App) handleBATags(w http.ResponseWriter, r *http.Request) {
	app.handleTags(w, r)
}

func (app *App) handleBANotes(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canReadPrivateNotes(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager or Admin support role required"})
		return
	}
	rows, err := app.DB.Pool.Query(r.Context(), `
		select pn.id, pn.content, pn.created_at, u.id, u.full_name, u.email, u.role, u.avatar_url
		from private_notes pn
		join users u on u.id = pn.created_by
		where pn.ba_id = $1
		order by pn.created_at desc`, chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, content string
		var createdAt time.Time
		var creator User
		var avatar sql.NullString
		if err := rows.Scan(&id, &content, &createdAt, &creator.ID, &creator.FullName, &creator.Email, &creator.Role, &avatar); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		if avatar.Valid {
			creator.AvatarURL = &avatar.String
		}
		items = append(items, map[string]any{"id": id, "content": content, "created_at": createdAt, "creator": creator.View()})
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleBAHistory(w http.ResponseWriter, r *http.Request) {
	bookings, err := app.fetchBookingHistory(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, bookings)
}

func (app *App) loadBAProfile(ctx context.Context, id string) (*BAProfile, error) {
	row := app.DB.Pool.QueryRow(ctx, `select id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, status_reason, status_changed_at, created_at, updated_at, version from ba_profiles where id = $1`, id)
	item, err := scanBAProfile(row)
	if err != nil {
		return nil, err
	}
	tags, _ := fetchSkillTagsForBA(app.DB.Pool, item.ID)
	item.SkillTags = tags
	return item, nil
}

func (app *App) fetchBookingsForBA(ctx context.Context, baID string, startDate, endDate time.Time) ([]Booking, error) {
	rows, err := app.DB.Pool.Query(ctx, `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where ba_id = $1 and end_date >= $2 and start_date <= $3 and status in ('APPROVED','IN_PROGRESS','PENDING','COMPLETED') order by start_date desc`, baID, startDate, endDate)
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
		project, _ := app.loadProject(ctx, booking.ProjectID)
		booking.Project = project
		items = append(items, *booking)
	}
	return items, rows.Err()
}

func (app *App) fetchBookingHistory(ctx context.Context, baID string) ([]Booking, error) {
	rows, err := app.DB.Pool.Query(ctx, `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where ba_id = $1 order by start_date desc`, baID)
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
		project, _ := app.loadProject(ctx, booking.ProjectID)
		booking.Project = project
		items = append(items, *booking)
	}
	return items, rows.Err()
}

func scanBooking(scanner interface{ Scan(dest ...any) error }) (*Booking, error) {
	var item Booking
	var baID, notes, managerID, rejectReason, cancelReason, managerComment sql.NullString
	var pendingRaw []byte
	var approvedAt, rejectedAt, cancelledAt sql.NullTime
	err := scanner.Scan(&item.ID, &baID, &item.ProjectID, &item.RequesterID, &managerID, &item.Title, &item.Description, &notes, &pendingRaw, &item.StartDate, &item.EndDate, &item.CapacityPercent, &item.Priority, &item.Status, &rejectReason, &cancelReason, &managerComment, &approvedAt, &rejectedAt, &cancelledAt, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if baID.Valid { item.BAID = &baID.String }
	if managerID.Valid { item.ManagerID = &managerID.String }
	if notes.Valid { item.Notes = &notes.String }
	if rejectReason.Valid { item.RejectReason = &rejectReason.String }
	if cancelReason.Valid { item.CancelReason = &cancelReason.String }
	if managerComment.Valid { item.ManagerComment = &managerComment.String }
	if approvedAt.Valid { t := approvedAt.Time; item.ApprovedAt = &t }
	if rejectedAt.Valid { t := rejectedAt.Time; item.RejectedAt = &t }
	if cancelledAt.Valid { t := cancelledAt.Time; item.CancelledAt = &t }
	if len(pendingRaw) > 0 {
		var decoded any
		if json.Unmarshal(pendingRaw, &decoded) == nil {
			item.PendingChanges = decoded
		}
	}
	return &item, nil
}

func (app *App) loadProject(ctx context.Context, id string) (*Project, error) {
	var item Project
	var description sql.NullString
	err := app.DB.Pool.QueryRow(ctx, `select id, name, color, description from projects where id = $1`, id).Scan(&item.ID, &item.Name, &item.Color, &description)
	if err != nil {
		return nil, err
	}
	if description.Valid {
		item.Description = &description.String
	}
	return &item, nil
}

func summarizeCurrentProjects(bookings []Booking) []map[string]any {
	totals := map[string]map[string]any{}
	for _, booking := range bookings {
		if booking.Project == nil {
			continue
		}
		current, ok := totals[booking.ProjectID]
		if !ok {
			current = map[string]any{"project_id": booking.Project.ID, "project_name": booking.Project.Name, "color": booking.Project.Color, "capacity_percent": 0}
			totals[booking.ProjectID] = current
		}
		current["capacity_percent"] = current["capacity_percent"].(int) + booking.CapacityPercent
	}
	items := make([]map[string]any, 0, len(totals))
	for _, item := range totals {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i]["capacity_percent"].(int) > items[j]["capacity_percent"].(int) })
	return items
}

func toPublicProfile(ba *BAProfile) map[string]any {
	return map[string]any{
		"id":         ba.ID,
		"full_name":  ba.FullName,
		"level":      ba.Level,
		"avatar_url": ba.AvatarURL,
		"status":     ba.Status,
		"skill_tags": ba.SkillTags,
	}
}

func resolveTimeframe(from, to string) (time.Time, time.Time, error) {
	if from != "" || to != "" {
		if from == "" || to == "" {
			return time.Time{}, time.Time{}, fmt.Errorf("from and to must be provided together")
		}
		startDate, err := parseDateOnly(from)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		endDate, err := parseDateOnly(to)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		if startDate.After(endDate) {
			return time.Time{}, time.Time{}, fmt.Errorf("from must be before or equal to to")
		}
		return startDate, endDate, nil
	}
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, -1)
	return start, end, nil
}
