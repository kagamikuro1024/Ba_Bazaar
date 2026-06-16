package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type adminAIOverview struct {
	Summary  adminAISummary   `json:"summary"`
	Features []featureHealth `json:"features"`
}

type adminAISummary struct {
	TotalSessions int     `json:"total_sessions"`
	ErrorCount    int     `json:"error_count"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
	TotalCost     float64 `json:"total_cost"`
}

type featureHealth struct {
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	Enabled      bool    `json:"enabled"`
	SessionCount int     `json:"session_count"`
	ErrorCount   int     `json:"error_count"`
	SuccessRate  float64 `json:"success_rate"`
}

func flagKeyToFeatureName(key string) string {
	switch key {
	case "ai_suggest_ba_enabled":
		return "AI_SUGGEST_BA"
	case "ai_prd_skill_extraction_enabled":
		return "AI_PRD_SKILL"
	case "ai_pmpo_chatbot_enabled":
		return "AI_PMPO_CHATBOT"
	case "ai_ba_manager_chatbot_enabled":
		return "AI_BAMGR_CHATBOT"
	case "ai_dashboard_summary_enabled":
		return "AI_DASHBOARD_SUMMARY"
	case "ai_report_summary_enabled":
		return "AI_REPORT_SUMMARY"
	default:
		return ""
	}
}

func (app *App) handleAdminAIOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var totalSessions, failedSessions int
	var avgLatency, totalCost float64

	// Query aggregate session stats
	_ = app.DB.Pool.QueryRow(ctx, `
		select 
			count(*), 
			count(*) filter (where status = 'FAILED' or error_count > 0), 
			coalesce(avg(duration_ms), 0), 
			coalesce(sum(estimated_cost)::float8, 0)
		from ai_sessions
	`).Scan(&totalSessions, &failedSessions, &avgLatency, &totalCost)

	var openErrors int
	_ = app.DB.Pool.QueryRow(ctx, `select count(*) from ai_errors where status = 'OPEN'`).Scan(&openErrors)

	// Fetch all flags
	rows, err := app.DB.Pool.Query(ctx, `select key, name, enabled from ai_feature_flags order by name asc`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	features := make([]featureHealth, 0)
	for rows.Next() {
		var f featureHealth
		if err := rows.Scan(&f.Key, &f.Name, &f.Enabled); err != nil {
			continue
		}

		featName := flagKeyToFeatureName(f.Key)
		if featName != "" {
			var total, success, errs int
			_ = app.DB.Pool.QueryRow(ctx, `
				select count(*), count(*) filter (where status = 'SUCCESS'), coalesce(sum(error_count), 0)
				from ai_sessions
				where feature_name = $1
			`, featName).Scan(&total, &success, &errs)

			f.SessionCount = total
			f.ErrorCount = errs
			if total > 0 {
				f.SuccessRate = (float64(success) / float64(total)) * 100
			} else {
				f.SuccessRate = 100.0
			}
		} else {
			f.SuccessRate = 100.0
		}
		features = append(features, f)
	}

	writeJSON(w, http.StatusOK, adminAIOverview{
		Summary: adminAISummary{
			TotalSessions: totalSessions,
			ErrorCount:    openErrors,
			AvgLatencyMs:  avgLatency,
			TotalCost:     totalCost,
		},
		Features: features,
	})
}

type adminAISessionRow struct {
	ID               string    `json:"id"`
	UserID           *string   `json:"user_id"`
	UserName         string    `json:"user_name"`
	UserRole         string    `json:"user_role"`
	FeatureName      string    `json:"feature_name"`
	EntryPoint       *string   `json:"entry_point"`
	Status           string    `json:"status"`
	ModelName        *string   `json:"model_name"`
	StartedAt        time.Time `json:"started_at"`
	DurationMs       *int      `json:"duration_ms"`
	ErrorCount       int       `json:"error_count"`
	TokenInput       *int      `json:"token_input"`
	TokenOutput      *int      `json:"token_output"`
	EstimatedCost    *float64  `json:"estimated_cost"`
}

func (app *App) handleAdminAISessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	where := " where 1=1"
	args := []any{}
	idx := 1

	if status := strings.TrimSpace(q.Get("status")); status != "" {
		where += fmt.Sprintf(" and s.status = $%d", idx)
		args = append(args, status)
		idx++
	}
	if feature := strings.TrimSpace(q.Get("feature_name")); feature != "" {
		where += fmt.Sprintf(" and s.feature_name = $%d", idx)
		args = append(args, feature)
		idx++
	}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		where += fmt.Sprintf(" and (s.feature_name ilike $%d or u.full_name ilike $%d)", idx, idx+1)
		args = append(args, "%"+search+"%", "%"+search+"%")
		idx += 2
	}

	var total int
	_ = app.DB.Pool.QueryRow(ctx, "select count(*) from ai_sessions s left join users u on u.id = s.user_id"+where, args...).Scan(&total)

	query := `
		select s.id, s.user_id, coalesce(u.full_name, 'System'), s.user_role, s.feature_name, s.entry_point, s.status, s.model_name, s.started_at, s.duration_ms, s.error_count, s.token_input, s.token_output, s.estimated_cost::float8
		from ai_sessions s
		left join users u on u.id = s.user_id
	` + where + " order by s.started_at desc"

	page, pageSize, paginated := parsePagination(r)
	if paginated {
		query += fmt.Sprintf(" limit $%d offset $%d", idx, idx+1)
		args = append(args, pageSize, (page-1)*pageSize)
	}

	rows, err := app.DB.Pool.Query(ctx, query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]adminAISessionRow, 0)
	for rows.Next() {
		var s adminAISessionRow
		var ep, model sql.NullString
		var dur, tokIn, tokOut sql.NullInt64
		var cost sql.NullFloat64
		var uid sql.NullString

		err := rows.Scan(
			&s.ID, &uid, &s.UserName, &s.UserRole, &s.FeatureName, &ep, &s.Status, &model, &s.StartedAt, &dur, &s.ErrorCount, &tokIn, &tokOut, &cost,
		)
		if err != nil {
			continue
		}
		if uid.Valid {
			v := uid.String
			s.UserID = &v
		}
		if ep.Valid {
			v := ep.String
			s.EntryPoint = &v
		}
		if model.Valid {
			v := model.String
			s.ModelName = &v
		}
		if dur.Valid {
			v := int(dur.Int64)
			s.DurationMs = &v
		}
		if tokIn.Valid {
			v := int(tokIn.Int64)
			s.TokenInput = &v
		}
		if tokOut.Valid {
			v := int(tokOut.Int64)
			s.TokenOutput = &v
		}
		if cost.Valid {
			v := cost.Float64
			s.EstimatedCost = &v
		}
		items = append(items, s)
	}

	if paginated {
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "page_size": pageSize, "total_pages": totalPages})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleAdminAISessionDetail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")

	var s adminAISessionRow
	var ep, model sql.NullString
	var dur, tokIn, tokOut sql.NullInt64
	var cost sql.NullFloat64
	var uid sql.NullString

	err := app.DB.Pool.QueryRow(ctx, `
		select s.id, s.user_id, coalesce(u.full_name, 'System'), s.user_role, s.feature_name, s.entry_point, s.status, s.model_name, s.started_at, s.duration_ms, s.error_count, s.token_input, s.token_output, s.estimated_cost::float8
		from ai_sessions s
		left join users u on u.id = s.user_id
		where s.id = $1
	`, id).Scan(&s.ID, &uid, &s.UserName, &s.UserRole, &s.FeatureName, &ep, &s.Status, &model, &s.StartedAt, &dur, &s.ErrorCount, &tokIn, &tokOut, &cost)

	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Session not found"})
		return
	}
	if uid.Valid {
		v := uid.String
		s.UserID = &v
	}
	if ep.Valid {
		v := ep.String
		s.EntryPoint = &v
	}
	if model.Valid {
		v := model.String
		s.ModelName = &v
	}
	if dur.Valid {
		v := int(dur.Int64)
		s.DurationMs = &v
	}
	if tokIn.Valid {
		v := int(tokIn.Int64)
		s.TokenInput = &v
	}
	if tokOut.Valid {
		v := int(tokOut.Int64)
		s.TokenOutput = &v
	}
	if cost.Valid {
		v := cost.Float64
		s.EstimatedCost = &v
	}

	// Fetch messages
	messages := make([]map[string]any, 0)
	mRows, err := app.DB.Pool.Query(ctx, `select sender, content, sanitized_content, created_at from ai_messages where session_id = $1 order by created_at asc`, id)
	if err == nil {
		defer mRows.Close()
		for mRows.Next() {
			var sender, raw, san string
			var cat time.Time
			if err := mRows.Scan(&sender, &raw, &san, &cat); err == nil {
				messages = append(messages, map[string]any{
					"sender":            sender,
					"content":           raw,
					"sanitized_content": san,
					"created_at":        cat,
				})
			}
		}
	}

	// Fetch tool calls
	toolCalls := make([]map[string]any, 0)
	tRows, err := app.DB.Pool.Query(ctx, `select id, tool_name, input_json, output_json, status, latency_ms, error_message, created_at from ai_tool_calls where session_id = $1 order by created_at asc`, id)
	if err == nil {
		defer tRows.Close()
		for tRows.Next() {
			var tid, name, status string
			var inp, out []byte
			var lat sql.NullInt64
			var errStr sql.NullString
			var cat time.Time
			if err := tRows.Scan(&tid, &name, &inp, &out, &status, &lat, &errStr, &cat); err == nil {
				tc := map[string]any{
					"id":         tid,
					"tool_name":  name,
					"input_json": json.RawMessage(inp),
					"status":     status,
					"created_at": cat,
				}
				if len(out) > 0 {
					tc["output_json"] = json.RawMessage(out)
				}
				if lat.Valid {
					tc["latency_ms"] = lat.Int64
				}
				if errStr.Valid {
					tc["error_message"] = errStr.String
				}
				toolCalls = append(toolCalls, tc)
			}
		}
	}

	// Fetch extractions
	extractions := make([]map[string]any, 0)
	eRows, err := app.DB.Pool.Query(ctx, `select id, extraction_type, raw_input, extracted_json, missing_fields, confidence, created_at from ai_extractions where session_id = $1 order by created_at asc`, id)
	if err == nil {
		defer eRows.Close()
		for eRows.Next() {
			var eid, typ, raw string
			var ext, mis []byte
			var conf sql.NullFloat64
			var cat time.Time
			if err := eRows.Scan(&eid, &typ, &raw, &ext, &mis, &conf, &cat); err == nil {
				ex := map[string]any{
					"id":              eid,
					"extraction_type": typ,
					"raw_input":       raw,
					"extracted_json":  json.RawMessage(ext),
					"created_at":      cat,
				}
				if len(mis) > 0 {
					ex["missing_fields"] = json.RawMessage(mis)
				}
				if conf.Valid {
					ex["confidence"] = conf.Float64
				}
				extractions = append(extractions, ex)
			}
		}
	}

	// Fetch errors
	errors := make([]map[string]any, 0)
	errRows, err := app.DB.Pool.Query(ctx, `select id, error_type, severity, message, stack_trace, status, created_at from ai_errors where session_id = $1`, id)
	if err == nil {
		defer errRows.Close()
		for errRows.Next() {
			var erid, typ, sev, msg string
			var stack sql.NullString
			var status string
			var cat time.Time
			if err := errRows.Scan(&erid, &typ, &sev, &msg, &stack, &status, &cat); err == nil {
				er := map[string]any{
					"id":         erid,
					"error_type": typ,
					"severity":   sev,
					"message":    msg,
					"status":     status,
					"created_at": cat,
				}
				if stack.Valid {
					er["stack_trace"] = stack.String
				}
				errors = append(errors, er)
			}
		}
	}

	// Fetch feedback
	feedback := make([]map[string]any, 0)
	fRows, err := app.DB.Pool.Query(ctx, `select id, rating, category, comment, created_at from ai_feedback where session_id = $1`, id)
	if err == nil {
		defer fRows.Close()
		for fRows.Next() {
			var fid, rating string
			var cat, com sql.NullString
			var created time.Time
			if err := fRows.Scan(&fid, &rating, &cat, &com, &created); err == nil {
				fb := map[string]any{
					"id":         fid,
					"rating":     rating,
					"created_at": created,
				}
				if cat.Valid {
					fb["category"] = cat.String
				}
				if com.Valid {
					fb["comment"] = com.String
				}
				feedback = append(feedback, fb)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"session":     s,
		"messages":    messages,
		"tool_calls":  toolCalls,
		"extractions": extractions,
		"errors":      errors,
		"feedback":    feedback,
	})
}

func (app *App) handleAdminAIToolCalls(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	where := " where 1=1"
	args := []any{}
	idx := 1

	if sessID := strings.TrimSpace(q.Get("session_id")); sessID != "" {
		where += fmt.Sprintf(" and session_id = $%d", idx)
		args = append(args, sessID)
		idx++
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		where += fmt.Sprintf(" and status = $%d", idx)
		args = append(args, status)
		idx++
	}

	var total int
	_ = app.DB.Pool.QueryRow(ctx, "select count(*) from ai_tool_calls"+where, args...).Scan(&total)

	query := `
		select id, session_id, tool_name, input_json, output_json, status, latency_ms, error_message, created_at
		from ai_tool_calls
	` + where + " order by created_at desc"

	page, pageSize, paginated := parsePagination(r)
	if paginated {
		query += fmt.Sprintf(" limit $%d offset $%d", idx, idx+1)
		args = append(args, pageSize, (page-1)*pageSize)
	}

	rows, err := app.DB.Pool.Query(ctx, query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, sid, name, status string
		var inp, out []byte
		var lat sql.NullInt64
		var errMsg sql.NullString
		var created time.Time

		if err := rows.Scan(&id, &sid, &name, &inp, &out, &status, &lat, &errMsg, &created); err == nil {
			tc := map[string]any{
				"id":         id,
				"session_id": sid,
				"tool_name":  name,
				"input_json": json.RawMessage(inp),
				"status":     status,
				"created_at": created,
			}
			if len(out) > 0 {
				tc["output_json"] = json.RawMessage(out)
			}
			if lat.Valid {
				tc["latency_ms"] = lat.Int64
			}
			if errMsg.Valid {
				tc["error_message"] = errMsg.String
			}
			items = append(items, tc)
		}
	}

	if paginated {
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "page_size": pageSize, "total_pages": totalPages})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

type adminAIErrorRow struct {
	ID           string     `json:"id"`
	SessionID    *string    `json:"session_id"`
	FeatureName  string     `json:"feature_name"`
	ErrorType    string     `json:"error_type"`
	Severity     string     `json:"severity"`
	Message      string     `json:"message"`
	StackTrace   *string    `json:"stack_trace"`
	Status       string     `json:"status"`
	Note         *string    `json:"note"`
	ResolvedBy   *string    `json:"resolved_by"`
	ResolvedName string     `json:"resolved_name"`
	ResolvedAt   *time.Time `json:"resolved_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (app *App) handleAdminAIErrors(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	where := " where 1=1"
	args := []any{}
	idx := 1

	if status := strings.TrimSpace(q.Get("status")); status != "" {
		where += fmt.Sprintf(" and e.status = $%d", idx)
		args = append(args, status)
		idx++
	}
	if severity := strings.TrimSpace(q.Get("severity")); severity != "" {
		where += fmt.Sprintf(" and e.severity = $%d", idx)
		args = append(args, severity)
		idx++
	}

	var total int
	_ = app.DB.Pool.QueryRow(ctx, "select count(*) from ai_errors e"+where, args...).Scan(&total)

	query := `
		select e.id, e.session_id, e.feature_name, e.error_type, e.severity, e.message, e.stack_trace, e.status, e.note, e.resolved_by, coalesce(u.full_name, ''), e.resolved_at, e.created_at
		from ai_errors e
		left join users u on u.id = e.resolved_by
	` + where + " order by e.created_at desc"

	page, pageSize, paginated := parsePagination(r)
	if paginated {
		query += fmt.Sprintf(" limit $%d offset $%d", idx, idx+1)
		args = append(args, pageSize, (page-1)*pageSize)
	}

	rows, err := app.DB.Pool.Query(ctx, query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]adminAIErrorRow, 0)
	for rows.Next() {
		var e adminAIErrorRow
		var sid, stack, note, resBy sql.NullString
		var resAt sql.NullTime

		err := rows.Scan(&e.ID, &sid, &e.FeatureName, &e.ErrorType, &e.Severity, &e.Message, &stack, &e.Status, &note, &resBy, &e.ResolvedName, &resAt, &e.CreatedAt)
		if err != nil {
			continue
		}
		if sid.Valid {
			v := sid.String
			e.SessionID = &v
		}
		if stack.Valid {
			v := stack.String
			e.StackTrace = &v
		}
		if note.Valid {
			v := note.String
			e.Note = &v
		}
		if resBy.Valid {
			v := resBy.String
			e.ResolvedBy = &v
		}
		if resAt.Valid {
			v := resAt.Time
			e.ResolvedAt = &v
		}
		items = append(items, e)
	}

	if paginated {
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "page_size": pageSize, "total_pages": totalPages})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleAdminAIErrorResolve(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required"})
		return
	}

	var body struct {
		Note string `json:"note"`
	}
	_ = decodeJSON(r, &body)

	note := strings.TrimSpace(body.Note)

	res, err := app.DB.Pool.Exec(r.Context(), `
		update ai_errors 
		set status = 'RESOLVED', note = $1, resolved_by = $2, resolved_at = now() 
		where id = $3 and status = 'OPEN'
	`, nullIfEmptyString(note), actor.ID, id)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	if res.RowsAffected() == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Error already resolved or not found"})
		return
	}

	app.auditAdmin(r, actor, "AI_ERROR_RESOLVED", "AiError", id, "SUCCESS", nil, map[string]any{"note": note})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (app *App) handleAdminAIFeedback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	where := " where 1=1"
	args := []any{}
	idx := 1

	if rating := strings.TrimSpace(q.Get("rating")); rating != "" {
		where += fmt.Sprintf(" and f.rating = $%d", idx)
		args = append(args, rating)
		idx++
	}
	if feature := strings.TrimSpace(q.Get("feature_name")); feature != "" {
		where += fmt.Sprintf(" and f.feature_name = $%d", idx)
		args = append(args, feature)
		idx++
	}

	var total int
	_ = app.DB.Pool.QueryRow(ctx, "select count(*) from ai_feedback f"+where, args...).Scan(&total)

	query := `
		select f.id, f.session_id, f.user_id, coalesce(u.full_name, 'Unknown'), f.feature_name, f.rating, f.category, f.comment, f.created_at
		from ai_feedback f
		left join users u on u.id = f.user_id
	` + where + " order by f.created_at desc"

	page, pageSize, paginated := parsePagination(r)
	if paginated {
		query += fmt.Sprintf(" limit $%d offset $%d", idx, idx+1)
		args = append(args, pageSize, (page-1)*pageSize)
	}

	rows, err := app.DB.Pool.Query(ctx, query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, rating, feature string
		var sid, uid, uname, category, comment sql.NullString
		var created time.Time

		if err := rows.Scan(&id, &sid, &uid, &uname, &feature, &rating, &category, &comment, &created); err == nil {
			fb := map[string]any{
				"id":           id,
				"feature_name": feature,
				"rating":       rating,
				"created_at":   created,
			}
			if sid.Valid {
				fb["session_id"] = sid.String
			}
			if uid.Valid {
				fb["user_id"] = uid.String
			}
			if uname.Valid {
				fb["user_name"] = uname.String
			}
			if category.Valid {
				fb["category"] = category.String
			}
			if comment.Valid {
				fb["comment"] = comment.String
			}
			items = append(items, fb)
		}
	}

	if paginated {
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "page_size": pageSize, "total_pages": totalPages})
		return
	}
	writeJSON(w, http.StatusOK, items)
}
