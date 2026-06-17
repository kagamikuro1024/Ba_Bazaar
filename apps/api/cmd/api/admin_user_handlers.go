package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

var validUserRoles = map[string]bool{
	"BA_MANAGER": true, "PM_PO": true, "BA": true, "ADMIN": true, "IT_ADMIN": true,
}

type adminUserRow struct {
	ID          string  `json:"id"`
	FullName    string  `json:"full_name"`
	Email       string  `json:"email"`
	Role        string  `json:"role"`
	Status      string  `json:"status"`
	AvatarURL   *string `json:"avatar_url"`
	LastLoginAt *string `json:"last_login_at"`
	CreatedAt   string  `json:"created_at"`
}

// generateTempPassword returns a random, human-typable one-time password.
func generateTempPassword() string {
	buf := make([]byte, 9)
	if _, err := rand.Read(buf); err != nil {
		return "Tmp-" + newUUID()[:12]
	}
	return "Tmp-" + base64.RawURLEncoding.EncodeToString(buf)
}

// countActiveITAdmins counts active IT_ADMIN users, excluding excludeID. Used to
// stop the last IT Admin from being demoted or disabled.
func (app *App) countActiveITAdmins(ctx context.Context, excludeID string) int {
	var n int
	_ = app.DB.Pool.QueryRow(ctx, `select count(*) from users where role = 'IT_ADMIN' and status = 'ACTIVE' and id <> $1`, excludeID).Scan(&n)
	return n
}

func (app *App) handleAdminUsersList(w http.ResponseWriter, r *http.Request) {
	base := `select id, full_name, email, role::text, status::text, avatar_url, last_login_at, created_at from users`
	where := " where 1=1"
	args := []any{}
	idx := 1
	if role := strings.TrimSpace(r.URL.Query().Get("role")); role != "" {
		where += fmt.Sprintf(" and role = $%d", idx)
		args = append(args, role)
		idx++
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		where += fmt.Sprintf(" and status = $%d", idx)
		args = append(args, status)
		idx++
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if search == "" {
		search = strings.TrimSpace(r.URL.Query().Get("q"))
	}
	if search != "" {
		where += fmt.Sprintf(" and (full_name ilike $%d or email ilike $%d)", idx, idx+1)
		args = append(args, "%"+search+"%", "%"+search+"%")
		idx += 2
	}

	var total int
	if err := app.DB.Pool.QueryRow(r.Context(), "select count(*) from users"+where, args...).Scan(&total); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	query := base + where + " order by created_at desc"
	page, pageSize, paginated := parsePagination(r)
	if paginated {
		query += fmt.Sprintf(" limit $%d offset $%d", idx, idx+1)
		args = append(args, pageSize, (page-1)*pageSize)
	}

	rows, err := app.DB.Pool.Query(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]adminUserRow, 0)
	for rows.Next() {
		var u adminUserRow
		var avatar sql.NullString
		var last sql.NullTime
		var created time.Time
		if err := rows.Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &u.Status, &avatar, &last, &created); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		if avatar.Valid {
			v := avatar.String
			u.AvatarURL = &v
		}
		if last.Valid {
			v := last.Time.UTC().Format(time.RFC3339)
			u.LastLoginAt = &v
		}
		u.CreatedAt = created.UTC().Format(time.RFC3339)
		items = append(items, u)
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

type adminCreateUserInput struct {
	FullName  string  `json:"full_name"`
	Email     string  `json:"email"`
	Role      string  `json:"role"`
	Password  *string `json:"password"`
	AvatarURL *string `json:"avatar_url"`
}

func (app *App) handleAdminUserCreate(w http.ResponseWriter, r *http.Request) {
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	var in adminCreateUserInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	in.FullName = strings.TrimSpace(in.FullName)
	in.Email = strings.TrimSpace(in.Email)
	in.Role = strings.TrimSpace(in.Role)
	if in.FullName == "" || in.Email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "full_name and email are required"})
		return
	}
	if !validUserRoles[in.Role] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid role"})
		return
	}
	var exists bool
	_ = app.DB.Pool.QueryRow(r.Context(), `select exists(select 1 from users where lower(email) = lower($1))`, in.Email).Scan(&exists)
	if exists {
		writeJSON(w, http.StatusConflict, map[string]string{"message": "A user with this email already exists."})
		return
	}
	tempPassword := ""
	plain := ""
	if in.Password != nil && strings.TrimSpace(*in.Password) != "" {
		plain = strings.TrimSpace(*in.Password)
	} else {
		tempPassword = generateTempPassword()
		plain = tempPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), 10)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	id := newUUID()
	_, err = app.DB.Pool.Exec(r.Context(), `insert into users (id, full_name, email, role, status, password_hash, avatar_url, created_at, updated_at) values ($1,$2,$3,$4,'ACTIVE',$5,$6,now(),now())`, id, in.FullName, in.Email, in.Role, string(hash), nullableString(in.AvatarURL))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	app.auditAdmin(r, actor, "USER_CREATED", "User", id, "SUCCESS", nil, map[string]any{"email": in.Email, "role": in.Role})
	resp := map[string]any{"id": id, "full_name": in.FullName, "email": in.Email, "role": in.Role, "status": "ACTIVE"}
	if tempPassword != "" {
		resp["temp_password"] = tempPassword
	}
	writeJSON(w, http.StatusCreated, resp)
}

type adminUpdateUserInput struct {
	FullName  *string `json:"full_name"`
	AvatarURL *string `json:"avatar_url"`
}

func (app *App) handleAdminUserUpdate(w http.ResponseWriter, r *http.Request) {
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	id := chi.URLParam(r, "id")
	var in adminUpdateUserInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	sets := []string{"updated_at = now()"}
	args := []any{id}
	idx := 2
	if in.FullName != nil && strings.TrimSpace(*in.FullName) != "" {
		sets = append(sets, fmt.Sprintf("full_name = $%d", idx))
		args = append(args, strings.TrimSpace(*in.FullName))
		idx++
	}
	if in.AvatarURL != nil {
		sets = append(sets, fmt.Sprintf("avatar_url = $%d", idx))
		args = append(args, nullableString(in.AvatarURL))
		idx++
	}
	if len(sets) == 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Nothing to update."})
		return
	}
	tag, err := app.DB.Pool.Exec(r.Context(), `update users set `+strings.Join(sets, ", ")+` where id = $1`, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "User not found"})
		return
	}
	app.auditAdmin(r, actor, "USER_UPDATED", "User", id, "SUCCESS", nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

type adminRoleInput struct {
	Role string `json:"role"`
}

func (app *App) handleAdminUserRole(w http.ResponseWriter, r *http.Request) {
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	id := chi.URLParam(r, "id")
	var in adminRoleInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	in.Role = strings.TrimSpace(in.Role)
	if !validUserRoles[in.Role] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid role"})
		return
	}
	if id == actor.ID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "You cannot change your own role."})
		return
	}
	var oldRole, oldStatus string
	if err := app.DB.Pool.QueryRow(r.Context(), `select role::text, status::text from users where id = $1`, id).Scan(&oldRole, &oldStatus); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "User not found"})
		return
	}
	if oldRole == in.Role {
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "role": in.Role})
		return
	}
	if oldRole == "IT_ADMIN" && oldStatus == "ACTIVE" && app.countActiveITAdmins(r.Context(), id) == 0 {
		app.auditAdmin(r, actor, "USER_ROLE_CHANGED", "User", id, "DENIED", map[string]any{"role": oldRole}, map[string]any{"role": in.Role})
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Cannot demote the last active IT Admin."})
		return
	}
	if _, err := app.DB.Pool.Exec(r.Context(), `update users set role = $2, updated_at = now() where id = $1`, id, in.Role); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	app.auditAdmin(r, actor, "USER_ROLE_CHANGED", "User", id, "SUCCESS", map[string]any{"role": oldRole}, map[string]any{"role": in.Role})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "role": in.Role})
}

func (app *App) handleAdminUserDisable(w http.ResponseWriter, r *http.Request) {
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	id := chi.URLParam(r, "id")
	if id == actor.ID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "You cannot disable your own account."})
		return
	}
	var role, status string
	if err := app.DB.Pool.QueryRow(r.Context(), `select role::text, status::text from users where id = $1`, id).Scan(&role, &status); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "User not found"})
		return
	}
	if role == "IT_ADMIN" && status == "ACTIVE" && app.countActiveITAdmins(r.Context(), id) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Cannot disable the last active IT Admin."})
		return
	}
	if _, err := app.DB.Pool.Exec(r.Context(), `update users set status = 'DISABLED', updated_at = now() where id = $1`, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	app.auditAdmin(r, actor, "USER_DISABLED", "User", id, "SUCCESS", map[string]any{"status": status}, map[string]any{"status": "DISABLED"})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "DISABLED"})
}

func (app *App) handleAdminUserEnable(w http.ResponseWriter, r *http.Request) {
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	id := chi.URLParam(r, "id")
	var status string
	if err := app.DB.Pool.QueryRow(r.Context(), `select status::text from users where id = $1`, id).Scan(&status); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "User not found"})
		return
	}
	if _, err := app.DB.Pool.Exec(r.Context(), `update users set status = 'ACTIVE', updated_at = now() where id = $1`, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	app.auditAdmin(r, actor, "USER_ENABLED", "User", id, "SUCCESS", map[string]any{"status": status}, map[string]any{"status": "ACTIVE"})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "ACTIVE"})
}

func (app *App) handleAdminUserResetPassword(w http.ResponseWriter, r *http.Request) {
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	id := chi.URLParam(r, "id")
	var email string
	if err := app.DB.Pool.QueryRow(r.Context(), `select email from users where id = $1`, id).Scan(&email); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "User not found"})
		return
	}
	temp := generateTempPassword()
	hash, err := bcrypt.GenerateFromPassword([]byte(temp), 10)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	if _, err := app.DB.Pool.Exec(r.Context(), `update users set password_hash = $2, updated_at = now() where id = $1`, id, string(hash)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	// Kill existing sessions so the old password can't be reused.
	_, _ = app.DB.Pool.Exec(r.Context(), `update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, id)
	app.auditAdmin(r, actor, "PASSWORD_RESET", "User", id, "SUCCESS", nil, nil) // never log the password
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "temp_password": temp})
}
