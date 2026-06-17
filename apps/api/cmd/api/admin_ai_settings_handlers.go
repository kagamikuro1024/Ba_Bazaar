package main

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type adminFlagRow struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Enabled     bool      `json:"enabled"`
	Environment string    `json:"environment"`
	UpdatedBy   *string   `json:"updated_by"`
	UpdatedName string    `json:"updated_name"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (app *App) handleAdminAIFlags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	query := `
		select f.id, f.key, f.name, f.description, f.enabled, f.environment, f.updated_by, coalesce(u.full_name, ''), f.updated_at
		from ai_feature_flags f
		left join users u on u.id = f.updated_by
		order by f.name asc
	`
	rows, err := app.DB.Pool.Query(ctx, query)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]adminFlagRow, 0)
	for rows.Next() {
		var f adminFlagRow
		var desc, upBy sql.NullString
		err := rows.Scan(&f.ID, &f.Key, &f.Name, &desc, &f.Enabled, &f.Environment, &upBy, &f.UpdatedName, &f.UpdatedAt)
		if err != nil {
			continue
		}
		if desc.Valid {
			v := desc.String
			f.Description = &v
		}
		if upBy.Valid {
			v := upBy.String
			f.UpdatedBy = &v
		}
		items = append(items, f)
	}

	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleAdminAIFlagToggle(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required"})
		return
	}

	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}

	var oldEnabled bool
	err = app.DB.Pool.QueryRow(r.Context(), `select enabled from ai_feature_flags where key = $1`, key).Scan(&oldEnabled)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Feature flag not found"})
		return
	}

	if oldEnabled == body.Enabled {
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
		return
	}

	_, err = app.DB.Pool.Exec(r.Context(), `
		update ai_feature_flags
		set enabled = $1, updated_by = $2, updated_at = now()
		where key = $3
	`, body.Enabled, actor.ID, key)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	app.auditAdmin(r, actor, "AI_FEATURE_TOGGLED", "AiFeatureFlag", key, "SUCCESS", map[string]any{"enabled": oldEnabled}, map[string]any{"enabled": body.Enabled})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type adminSettingRow struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Description *string   `json:"description"`
	UpdatedBy   *string   `json:"updated_by"`
	UpdatedName string    `json:"updated_name"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (app *App) handleAdminAISettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	query := `
		select s.id, s.key, s.value, s.description, s.updated_by, coalesce(u.full_name, ''), s.updated_at
		from ai_settings s
		left join users u on u.id = s.updated_by
		order by s.key asc
	`
	rows, err := app.DB.Pool.Query(ctx, query)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]adminSettingRow, 0)
	for rows.Next() {
		var s adminSettingRow
		var desc, upBy sql.NullString
		err := rows.Scan(&s.ID, &s.Key, &s.Value, &desc, &upBy, &s.UpdatedName, &s.UpdatedAt)
		if err != nil {
			continue
		}
		if desc.Valid {
			v := desc.String
			s.Description = &v
		}
		if upBy.Valid {
			v := upBy.String
			s.UpdatedBy = &v
		}
		items = append(items, s)
	}

	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleAdminAISettingUpdate(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	actor, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required"})
		return
	}

	var body struct {
		Value string `json:"value"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}

	val := strings.TrimSpace(body.Value)
	if val == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "value cannot be empty"})
		return
	}

	var oldValue string
	err = app.DB.Pool.QueryRow(r.Context(), `select value from ai_settings where key = $1`, key).Scan(&oldValue)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Setting not found"})
		return
	}

	if oldValue == val {
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
		return
	}

	_, err = app.DB.Pool.Exec(r.Context(), `
		update ai_settings
		set value = $1, updated_by = $2, updated_at = now()
		where key = $3
	`, val, actor.ID, key)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	app.auditAdmin(r, actor, "AI_SETTING_CHANGED", "AiSetting", key, "SUCCESS", map[string]any{"value": oldValue}, map[string]any{"value": val})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
