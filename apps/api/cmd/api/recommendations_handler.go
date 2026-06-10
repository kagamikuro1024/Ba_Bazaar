package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// handleRecommendations serves GET /api/ba/recommendations.
//
// Query params (all parsed from r.URL.Query):
//   start_date         YYYY-MM-DD        required
//   end_date           YYYY-MM-DD        required
//   capacity_percent   1..100            required
//   required_skill_ids tag1,tag2         optional
//   level              JUNIOR|MIDDLE|SENIOR|LEAD  optional
//   project_id         uuid              optional
//   limit              1..25, default 5  optional
//   exclude_ba_ids     id1,id2           optional
//
// Auth: BA_MANAGER / ADMIN / PM_PO can request. BA users get their own
// profile only (and the result is filtered to themselves).
func (app *App) handleRecommendations(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canViewPrivateBAFields(user.Role) && user.Role != "PM_PO" && user.Role != "BA" {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Insufficient role"})
		return
	}
	_ = app.syncBookingStatuses(r.Context())

	q := r.URL.Query()

	startStr := strings.TrimSpace(q.Get("start_date"))
	endStr := strings.TrimSpace(q.Get("end_date"))
	capStr := strings.TrimSpace(q.Get("capacity_percent"))
	if startStr == "" || endStr == "" || capStr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "start_date, end_date, and capacity_percent are required"})
		return
	}
	startDate, err := parseDateOnly(startStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	endDate, err := parseDateOnly(endStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if startDate.After(endDate) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "start_date must be on or before end_date"})
		return
	}
	capPct, err := strconv.Atoi(capStr)
	if err != nil || capPct < 1 || capPct > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "capacity_percent must be an integer in 1..100"})
		return
	}
	level := strings.TrimSpace(q.Get("level"))
	if level != "" {
		switch level {
		case "JUNIOR", "MIDDLE", "SENIOR", "LEAD":
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": "level must be one of JUNIOR, MIDDLE, SENIOR, LEAD"})
			return
		}
	}
	projectID := strings.TrimSpace(q.Get("project_id"))
	limit := 5
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": "limit must be a positive integer"})
			return
		}
		limit = v
	}

	requiredSkillIDs := ParseSkillIDs(q["required_skill_ids"])
	exclude := map[string]bool{}
	for _, id := range ParseSkillIDs(q["exclude_ba_ids"]) {
		exclude[id] = true
	}

	// Fetch candidate BAs. BA users are scoped to themselves.
	candidates, err := app.loadCandidateBAs(r.Context(), user, level, requiredSkillIDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	// BA users: limit candidates to their own profile; the ranker
	// applies the same filter but doing it here keeps IO bounded.
	if user.Role == "BA" {
		own := candidates[:0]
		for _, c := range candidates {
			if c.UserID != nil && *c.UserID == user.ID {
				own = append(own, c)
			}
		}
		candidates = own
	}

	// Pre-load bookings overlapping a generous window so the capacity
	// engine sees every relevant overlap (it iterates day-by-day).
	loadStart := startDate.AddDate(0, 0, -90)
	loadEnd := endDate.AddDate(0, 0, 90)
	bookingsByBA, err := app.loadBookingsForCandidates(r.Context(), candidates, loadStart, loadEnd)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	// Affinity counts.
	projectCounts := map[string]int{}
	totalCounts := map[string]int{}
	if projectID != "" {
		projectCounts, err = app.loadProjectBookingCounts(r.Context(), projectID, candidates)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
	}
	totalCounts, err = app.loadTotalBookingCounts(r.Context(), candidates)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	scored := make([]CandidateBA, 0, len(candidates))
	for _, c := range candidates {
		scored = append(scored, CandidateBA{
			ID:          c.ID,
			FullName:    c.FullName,
			Level:       c.Level,
			Status:      c.Status,
			SkillTagIDs: c.SkillTagIDs,
			Bookings:    bookingsByBA[c.ID],
		})
	}

	rq := RecommendationQuery{
		StartDate:            startDate,
		EndDate:              endDate,
		CapacityPercent:      capPct,
		RequiredSkillIDs:     requiredSkillIDs,
		Level:                level,
		ProjectID:            projectID,
		ProjectBookingCounts: projectCounts,
		TotalBookingCounts:   totalCounts,
		ExcludeBAIDs:         exclude,
		Limit:                limit,
	}
	results := RankCandidates(scored, rq)

	writeJSON(w, http.StatusOK, map[string]any{
		"query": map[string]any{
			"start_date":       toDateKey(startDate),
			"end_date":         toDateKey(endDate),
			"capacity_percent": capPct,
			"required_skill_ids": requiredSkillIDs,
			"level":            level,
			"project_id":       projectID,
			"limit":            limit,
		},
		"results": results,
	})
}

// candidateBA is the row pulled from the DB before projecting to CandidateBA.
type candidateBA struct {
	ID         string
	UserID     *string
	FullName   string
	Level      string
	Status     string
	SkillTagIDs []string
}

// loadCandidateBAs returns all BAs that should be considered. PM_PO and
// "bookable" callers only see ACTIVE. BA users see only themselves (further
// filtered downstream). Manager/Admin see everything.
func (app *App) loadCandidateBAs(ctx context.Context, user *User, level string, requiredSkillIDs []string) ([]candidateBA, error) {
	query := `select id, user_id, full_name, level, status from ba_profiles where 1=1`
	args := make([]any, 0)
	idx := 1
	if user.Role == "PM_PO" {
		query += " and status = $1"
		args = append(args, "ACTIVE")
		idx++
	}
	if user.Role == "BA" {
		query += " and user_id = $1"
		args = append(args, user.ID)
		idx++
	}
	if level != "" {
		query += " and level = $" + strconv.Itoa(idx)
		args = append(args, level)
		idx++
	}
	// If skills are required, narrow at the SQL level to BAs that have at
	// least one of them (still Jaccard-soft at scoring time, but cuts IO).
	if len(requiredSkillIDs) > 0 {
		query += " and exists (select 1 from ba_skill_tags bst where bst.ba_id = ba_profiles.id and bst.tag_id = any($" + strconv.Itoa(idx) + "::uuid[]))"
		args = append(args, requiredSkillIDs)
		idx++
	}
	query += " order by full_name asc"

	rows, err := app.DB.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]candidateBA, 0, 32)
	for rows.Next() {
		var c candidateBA
		var uid *string
		if err := rows.Scan(&c.ID, &uid, &c.FullName, &c.Level, &c.Status); err != nil {
			return nil, err
		}
		c.UserID = uid
		tags, err := fetchSkillTagsForBA(app.DB.Pool, c.ID)
		if err != nil {
			return nil, err
		}
		for _, t := range tags {
			c.SkillTagIDs = append(c.SkillTagIDs, t.Tag.ID)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// loadBookingsForCandidates fetches all bookings overlapping [start, end]
// for the given candidates in one IN-clause query.
func (app *App) loadBookingsForCandidates(ctx context.Context, candidates []candidateBA, startDate, endDate time.Time) (map[string][]CapacityBooking, error) {
	out := map[string][]CapacityBooking{}
	if len(candidates) == 0 {
		return out, nil
	}
	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.ID
	}
	rows, err := app.DB.Pool.Query(ctx, `
		select id, ba_id, start_date, end_date, capacity_percent, status
		from bookings
		where ba_id = any($1::uuid[])
		  and end_date >= $2
		  and start_date <= $3
		  and status in ('APPROVED','IN_PROGRESS','PENDING','COMPLETED')`,
		ids, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b CapacityBooking
		var baID *string
		if err := rows.Scan(&b.ID, &baID, &b.StartDate, &b.EndDate, &b.CapacityPercent, &b.Status); err != nil {
			return nil, err
		}
		b.BAID = baID
		if baID != nil {
			out[*baID] = append(out[*baID], b)
		}
	}
	return out, rows.Err()
}

// loadProjectBookingCounts returns the count of non-cancelled bookings per
// (ba, projectID). Used for project_affinity.
func (app *App) loadProjectBookingCounts(ctx context.Context, projectID string, candidates []candidateBA) (map[string]int, error) {
	out := map[string]int{}
	if len(candidates) == 0 {
		return out, nil
	}
	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.ID
	}
	rows, err := app.DB.Pool.Query(ctx, `
		select ba_id, count(*)
		from bookings
		where project_id = $1
		  and ba_id = any($2::uuid[])
		  and status <> 'CANCELLED'
		  and status <> 'REJECTED'
		group by ba_id`,
		projectID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var baID string
		var count int
		if err := rows.Scan(&baID, &count); err != nil {
			return nil, err
		}
		out[baID] = count
	}
	return out, rows.Err()
}

// loadTotalBookingCounts returns the count of all non-cancelled bookings per
// BA. Used to normalize the project_affinity ratio.
func (app *App) loadTotalBookingCounts(ctx context.Context, candidates []candidateBA) (map[string]int, error) {
	out := map[string]int{}
	if len(candidates) == 0 {
		return out, nil
	}
	ids := make([]string, len(candidates))
	for i, c := range candidates {
		ids[i] = c.ID
	}
	rows, err := app.DB.Pool.Query(ctx, `
		select ba_id, count(*)
		from bookings
		where ba_id = any($1::uuid[])
		  and status <> 'CANCELLED'
		  and status <> 'REJECTED'
		group by ba_id`,
		ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var baID string
		var count int
		if err := rows.Scan(&baID, &count); err != nil {
			return nil, err
		}
		out[baID] = count
	}
	return out, rows.Err()
}

// _ keeps chi import in for the future /api/ba/{id}/recommendations scope.
var _ = chi.URLParam
