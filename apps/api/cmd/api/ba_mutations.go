package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

func (app *App) createAuditLog(ctx context.Context, actorID, action, targetType, targetID, result string, oldValue, newValue any) {
	var oldJSON any
	var newJSON any
	if oldValue != nil {
		if encoded, err := json.Marshal(oldValue); err == nil {
			oldJSON = string(encoded)
		}
	}
	if newValue != nil {
		if encoded, err := json.Marshal(newValue); err == nil {
			newJSON = string(encoded)
		}
	}
	_, _ = app.DB.Pool.Exec(ctx, `insert into audit_logs (id, actor_id, action, target_type, target_id, old_value, new_value, result, created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,now())`, newUUID(), actorID, action, targetType, targetID, oldJSON, newJSON, result)
}

func (app *App) handleBACreate(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !isManagerRole(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"})
		return
	}
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(asString(body["email"])))
	fullName := strings.TrimSpace(asString(body["full_name"]))
	password := strings.TrimSpace(asString(body["password"]))
	if email == "" || fullName == "" || len(password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "email, full_name, and password(>=8) are required"})
		return
	}
	if _, err := app.findUserByEmail(r.Context(), email); err == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "User email already exists"})
		return
	}
	var exists int
	_ = app.DB.Pool.QueryRow(r.Context(), `select count(*) from ba_profiles where lower(email) = lower($1)`, email).Scan(&exists)
	if exists > 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "BA email already exists"})
		return
	}
	hash, _ := bcryptHash(password)
	userID := newUUID()
	avatarURL := trimNullableString(asString(body["avatar_url"]))
	_, err = app.DB.Pool.Exec(r.Context(), `insert into users (id, full_name, email, role, password_hash, avatar_url, created_at, updated_at) values ($1,$2,$3,'BA',$4,$5,now(),now())`, userID, fullName, email, hash, avatarURL)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	baID := newUUID()
	joinedDate := time.Now().UTC()
	if raw := strings.TrimSpace(asString(body["joined_date"])); raw != "" {
		if joinedDate, err = parseDateOnly(raw); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
			return
		}
	}
	level := strings.TrimSpace(asString(body["level"]))
	if level == "" {
		level = "MIDDLE"
	}
	status := strings.TrimSpace(asString(body["status"]))
	if status == "" {
		status = "ACTIVE"
	}
	_, err = app.DB.Pool.Exec(r.Context(), `insert into ba_profiles (id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),1)`, baID, userID, fullName, email, trimNullableString(asString(body["phone"])), level, joinedDate, avatarURL, status)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	created, _ := app.loadBAProfile(r.Context(), baID)
	app.createAuditLog(r.Context(), user.ID, "CREATE_BA_ACCOUNT", "BAProfile", baID, "SUCCESS", nil, map[string]any{"id": baID, "email": email, "user_id": userID})
	writeJSON(w, http.StatusOK, created)
}

func (app *App) handleBAUpdate(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	id := chi.URLParam(r, "id")
	existing, err := app.loadBAProfile(r.Context(), id)
	if err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "BA profile not found"}); return }
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"}); return }
	if email := strings.TrimSpace(asString(body["email"])); email != "" && !strings.EqualFold(email, existing.Email) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "BA email is immutable"})
		return
	}
	changes := []string{"version = version + 1", "updated_at = now()"}
	args := []any{id}
	index := 2
	if _, ok := body["full_name"]; ok {
		changes = append(changes, fmt.Sprintf("full_name = $%d", index))
		args = append(args, nilIfBlank(asString(body["full_name"])))
		index++
	}
	if _, ok := body["phone"]; ok {
		changes = append(changes, fmt.Sprintf("phone = $%d", index))
		args = append(args, nullableKeepBlank(body, "phone"))
		index++
	}
	if _, ok := body["level"]; ok {
		changes = append(changes, fmt.Sprintf("level = $%d", index))
		args = append(args, nilIfBlank(asString(body["level"])))
		index++
	}
	if _, ok := body["joined_date"]; ok {
		changes = append(changes, fmt.Sprintf("joined_date = $%d", index))
		args = append(args, parseDateArg(body, "joined_date"))
		index++
	}
	if _, ok := body["avatar_url"]; ok {
		changes = append(changes, fmt.Sprintf("avatar_url = $%d", index))
		args = append(args, nullableKeepBlank(body, "avatar_url"))
		index++
	}
	_, err = app.DB.Pool.Exec(r.Context(), `update ba_profiles set `+strings.Join(changes, ", ")+` where id = $1`, args...)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	updated, _ := app.loadBAProfile(r.Context(), id)
	app.createAuditLog(r.Context(), user.ID, "UPDATE_BA_PROFILE", "BAProfile", id, "SUCCESS", existing, updated)
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBAChangeStatus(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	id := chi.URLParam(r, "id")
	existing, err := app.loadBAProfile(r.Context(), id)
	if err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "BA profile not found"}); return }
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"}); return }
	status := strings.TrimSpace(asString(body["status"]))
	if status == "" { status = "ACTIVE" }
	reason := strings.TrimSpace(asString(firstDefined(body, "status_reason", "reason")))
	_, err = app.DB.Pool.Exec(r.Context(), `update ba_profiles set status = $2, status_reason = $3, status_changed_at = now(), version = version + 1, updated_at = now() where id = $1`, id, status, nullIfBlank(reason))
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	updated, _ := app.loadBAProfile(r.Context(), id)
	app.createAuditLog(r.Context(), user.ID, "CHANGE_BA_STATUS", "BAProfile", id, "SUCCESS", existing, updated)
	writeJSON(w, http.StatusOK, updated)
}

func (app *App) handleBAAddTag(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	baID := chi.URLParam(r, "id")
	if _, err := app.loadBAProfile(r.Context(), baID); err != nil { writeJSON(w, http.StatusNotFound, map[string]string{"message": "BA profile not found"}); return }
	var payload map[string]any
	if err := decodeJSON(r, &payload); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"}); return }
	tagID := strings.TrimSpace(asString(payload["tag_id"]))
	if !uuidPattern.MatchString(tagID) { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "tag_id must be a valid UUID of an existing active tag"}); return }
	var exists int
	_ = app.DB.Pool.QueryRow(r.Context(), `select count(*) from skill_tags where id = $1 and status = 'ACTIVE'`, tagID).Scan(&exists)
	if exists == 0 { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Active tag_id does not exist"}); return }
	_, err = app.DB.Pool.Exec(r.Context(), `insert into ba_skill_tags (id, ba_id, tag_id, assigned_by, assigned_at) values ($1,$2,$3,$4,now()) on conflict (ba_id, tag_id) do nothing`, newUUID(), baID, tagID, user.ID)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	app.createAuditLog(r.Context(), user.ID, "ADD_BA_TAG", "BAProfile", baID, "SUCCESS", nil, map[string]any{"tag_id": tagID})
	rows, err := app.DB.Pool.Query(r.Context(), `select bst.id, st.id, st.name, st."group", st.status, st.created_at, st.updated_at from ba_skill_tags bst join skill_tags st on st.id = bst.tag_id where bst.ba_id = $1 and bst.tag_id = $2`, baID, tagID)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	defer rows.Close()
	if rows.Next() {
		var mappingID string
		var tag SkillTag
		if err := rows.Scan(&mappingID, &tag.ID, &tag.Name, &tag.Group, &tag.Status, &tag.CreatedAt, &tag.UpdatedAt); err == nil {
			writeJSON(w, http.StatusOK, map[string]any{"id": mappingID, "tag": tag})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (app *App) handleBARemoveTag(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	baID := chi.URLParam(r, "id")
	tagID := chi.URLParam(r, "tagId")
	_, err = app.DB.Pool.Exec(r.Context(), `delete from ba_skill_tags where ba_id = $1 and tag_id = $2`, baID, tagID)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	app.createAuditLog(r.Context(), user.ID, "REMOVE_BA_TAG", "BAProfile", baID, "SUCCESS", map[string]any{"tag_id": tagID}, nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (app *App) handleBAAudit(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	id := chi.URLParam(r, "id")
	rows, err := app.DB.Pool.Query(r.Context(), `select a.id, a.action, a.target_type, a.target_id, a.old_value, a.new_value, a.result, a.created_at, u.id, u.full_name, u.email, u.role, u.avatar_url from audit_logs a join users u on u.id = a.actor_id where a.target_type = 'BAProfile' and a.target_id = $1 order by a.created_at desc`, id)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, action, targetType, targetID, result string
		var oldJSON, newJSON sql.NullString
		var createdAt time.Time
		var actor User
		var avatar sql.NullString
		if err := rows.Scan(&id, &action, &targetType, &targetID, &oldJSON, &newJSON, &result, &createdAt, &actor.ID, &actor.FullName, &actor.Email, &actor.Role, &avatar); err != nil { continue }
		if avatar.Valid { actor.AvatarURL = &avatar.String }
		items = append(items, map[string]any{"id": id, "action": action, "target_type": targetType, "target_id": targetID, "old_value": parseJSONText(oldJSON), "new_value": parseJSONText(newJSON), "result": result, "created_at": createdAt, "actor": actor.View()})
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleBAAppendNote(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil { writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."}); return }
	if !isManagerRole(user.Role) { writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA Manager role required"}); return }
	baID := chi.URLParam(r, "id")
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"}); return }
	content := strings.TrimSpace(asString(body["content"]))
	if content == "" || len(content) > 5000 { writeJSON(w, http.StatusBadRequest, map[string]string{"message": "content must be 1..5000 characters"}); return }
	noteID := newUUID()
	_, err = app.DB.Pool.Exec(r.Context(), `insert into private_notes (id, ba_id, content, created_by, created_at, visibility) values ($1,$2,$3,$4,now(),'MANAGER_ONLY')`, noteID, baID, content, user.ID)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()}); return }
	app.createAuditLog(r.Context(), user.ID, "APPEND_PRIVATE_NOTE", "BAProfile", baID, "SUCCESS", nil, map[string]any{"note_id": noteID})
	writeJSON(w, http.StatusOK, map[string]any{"id": noteID, "content": content, "created_at": time.Now().UTC(), "creator": user.View()})
}

func asString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	default:
		return ""
	}
}

func trimNullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nilIfBlank(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullIfBlank(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func firstDefined(body map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return value
		}
	}
	return nil
}

func parseDateArg(body map[string]any, key string) any {
	value := strings.TrimSpace(asString(body[key]))
	if value == "" {
		return nil
	}
	parsed, err := parseDateOnly(value)
	if err != nil {
		return nil
	}
	return parsed
}

func nullableKeepBlank(body map[string]any, key string) any {
	if _, ok := body[key]; !ok {
		return nil
	}
	return trimNullableString(asString(body[key]))
}

func parseJSONText(value sql.NullString) any {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	var decoded any
	if err := json.Unmarshal([]byte(value.String), &decoded); err != nil {
		return value.String
	}
	return decoded
}

func bcryptHash(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	return string(hash), err
}
