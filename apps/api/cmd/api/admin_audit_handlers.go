package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type adminAuditRow struct {
	ID         string  `json:"id"`
	ActorID    string  `json:"actor_id"`
	ActorName  string  `json:"actor_name"`
	ActorEmail string  `json:"actor_email"`
	ActorRole  string  `json:"actor_role"`
	Action     string  `json:"action"`
	TargetType string  `json:"target_type"`
	TargetID   *string `json:"target_id"`
	Result     string  `json:"result"`
	IPAddress  *string `json:"ip_address"`
	CreatedAt  string  `json:"created_at"`
}

// scannableRows is satisfied by pgx.Rows; lets us share scan logic without
// importing pgx in this file.
type scannableRows interface {
	Next() bool
	Scan(dest ...any) error
}

const auditSelect = `select a.id, a.actor_id, coalesce(u.full_name, ''), coalesce(u.email, ''), coalesce(a.actor_role, u.role::text, ''), a.action, a.target_type, a.target_id, a.result::text, a.ip_address, a.created_at from audit_logs a left join users u on u.id = a.actor_id`

func scanAuditRows(rows scannableRows) []adminAuditRow {
	items := make([]adminAuditRow, 0)
	for rows.Next() {
		var row adminAuditRow
		var targetID, ip sql.NullString
		var created time.Time
		if err := rows.Scan(&row.ID, &row.ActorID, &row.ActorName, &row.ActorEmail, &row.ActorRole, &row.Action, &row.TargetType, &targetID, &row.Result, &ip, &created); err != nil {
			continue
		}
		if targetID.Valid {
			v := targetID.String
			row.TargetID = &v
		}
		if ip.Valid {
			v := ip.String
			row.IPAddress = &v
		}
		row.CreatedAt = created.UTC().Format(time.RFC3339)
		items = append(items, row)
	}
	return items
}

func (app *App) recentAuditRows(ctx context.Context, limit int) []adminAuditRow {
	rows, err := app.DB.Pool.Query(ctx, auditSelect+" order by a.created_at desc limit $1", limit)
	if err != nil {
		return []adminAuditRow{}
	}
	defer rows.Close()
	return scanAuditRows(rows)
}

func (app *App) handleAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	where := " where 1=1"
	args := []any{}
	idx := 1
	q := r.URL.Query()
	if action := strings.TrimSpace(q.Get("action")); action != "" {
		where += fmt.Sprintf(" and a.action = $%d", idx)
		args = append(args, action)
		idx++
	}
	if actor := strings.TrimSpace(q.Get("actor_id")); actor != "" {
		where += fmt.Sprintf(" and a.actor_id = $%d", idx)
		args = append(args, actor)
		idx++
	}
	if result := strings.TrimSpace(q.Get("result")); result != "" {
		where += fmt.Sprintf(" and a.result = $%d", idx)
		args = append(args, result)
		idx++
	}
	if from := strings.TrimSpace(q.Get("from")); from != "" {
		if d, err := parseDateOnly(from); err == nil {
			where += fmt.Sprintf(" and a.created_at >= $%d", idx)
			args = append(args, d)
			idx++
		}
	}
	if to := strings.TrimSpace(q.Get("to")); to != "" {
		if d, err := parseDateOnly(to); err == nil {
			where += fmt.Sprintf(" and a.created_at < $%d", idx)
			args = append(args, d.AddDate(0, 0, 1))
			idx++
		}
	}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		where += fmt.Sprintf(" and (a.action ilike $%d or u.full_name ilike $%d or u.email ilike $%d)", idx, idx+1, idx+2)
		s := "%" + search + "%"
		args = append(args, s, s, s)
		idx += 3
	}

	var total int
	if err := app.DB.Pool.QueryRow(r.Context(), `select count(*) from audit_logs a left join users u on u.id = a.actor_id`+where, args...).Scan(&total); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	query := auditSelect + where + " order by a.created_at desc"
	page, pageSize, paginated := parsePagination(r)
	if paginated {
		query += fmt.Sprintf(" limit $%d offset $%d", idx, idx+1)
		args = append(args, pageSize, (page-1)*pageSize)
	} else {
		query += " limit 100"
	}
	rows, err := app.DB.Pool.Query(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	items := scanAuditRows(rows)
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

func (app *App) handleAdminAuditLogByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var (
		row                          adminAuditRow
		targetID, ip, ua             sql.NullString
		oldVal, newVal               sql.NullString
		created                      time.Time
	)
	err := app.DB.Pool.QueryRow(r.Context(), `select a.id, a.actor_id, coalesce(u.full_name, ''), coalesce(u.email, ''), coalesce(a.actor_role, u.role::text, ''), a.action, a.target_type, a.target_id, a.result::text, a.ip_address, a.user_agent, a.old_value::text, a.new_value::text, a.created_at from audit_logs a left join users u on u.id = a.actor_id where a.id = $1`, id).
		Scan(&row.ID, &row.ActorID, &row.ActorName, &row.ActorEmail, &row.ActorRole, &row.Action, &row.TargetType, &targetID, &row.Result, &ip, &ua, &oldVal, &newVal, &created)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Audit log not found"})
		return
	}
	if targetID.Valid {
		v := targetID.String
		row.TargetID = &v
	}
	if ip.Valid {
		v := ip.String
		row.IPAddress = &v
	}
	row.CreatedAt = created.UTC().Format(time.RFC3339)
	resp := map[string]any{
		"id": row.ID, "actor_id": row.ActorID, "actor_name": row.ActorName, "actor_email": row.ActorEmail,
		"actor_role": row.ActorRole, "action": row.Action, "target_type": row.TargetType, "target_id": row.TargetID,
		"result": row.Result, "ip_address": row.IPAddress, "created_at": row.CreatedAt,
	}
	if ua.Valid {
		resp["user_agent"] = ua.String
	}
	if oldVal.Valid && oldVal.String != "" {
		resp["old_value"] = json.RawMessage(oldVal.String)
	}
	if newVal.Valid && newVal.String != "" {
		resp["new_value"] = json.RawMessage(newVal.String)
	}
	writeJSON(w, http.StatusOK, resp)
}
