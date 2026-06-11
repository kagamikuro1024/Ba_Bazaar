package main

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Project struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Color       string  `json:"color"`
	Description *string `json:"description"`
}

type SkillTag struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Group     string    `json:"group"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Notification struct {
	ID                string     `json:"id"`
	RecipientID       string     `json:"recipient_id"`
	Type              string     `json:"type"`
	Title             string     `json:"title"`
	Message           string     `json:"message"`
	RelatedEntityType *string    `json:"related_entity_type"`
	RelatedEntityID   *string    `json:"related_entity_id"`
	ReadAt            *time.Time `json:"read_at"`
	CreatedAt         time.Time  `json:"created_at"`
}

func (app *App) handleProjects(w http.ResponseWriter, r *http.Request) {
	rows, err := app.DB.Pool.Query(r.Context(), `select id, name, color, description from projects order by name asc`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]Project, 0)
	for rows.Next() {
		var item Project
		var description sql.NullString
		if err := rows.Scan(&item.ID, &item.Name, &item.Color, &description); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		if description.Valid {
			item.Description = &description.String
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleTags(w http.ResponseWriter, r *http.Request) {
	rows, err := app.DB.Pool.Query(r.Context(), `
		select id, name, "group", status, created_at, updated_at
		from skill_tags
		where status = 'ACTIVE'
		order by "group" asc, name asc`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]SkillTag, 0)
	for rows.Next() {
		var item SkillTag
		if err := rows.Scan(&item.ID, &item.Name, &item.Group, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleNotifications(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	page, pageSize, paginated := parsePagination(r)
	if paginated {
		var total int
		if err := app.DB.Pool.QueryRow(r.Context(), `select count(*) from notifications where recipient_id = $1`, user.ID).Scan(&total); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		rows, err := app.DB.Pool.Query(r.Context(), `
			select id, recipient_id, type, title, message, related_entity_type, related_entity_id, read_at, created_at
			from notifications
			where recipient_id = $1
			order by created_at desc
			limit $2 offset $3`, user.ID, pageSize, (page-1)*pageSize)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		defer rows.Close()
		items := make([]Notification, 0)
		for rows.Next() {
			var item Notification
			var relatedType sql.NullString
			var relatedID sql.NullString
			var readAt sql.NullTime
			if err := rows.Scan(&item.ID, &item.RecipientID, &item.Type, &item.Title, &item.Message, &relatedType, &relatedID, &readAt, &item.CreatedAt); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
				return
			}
			if relatedType.Valid {
				item.RelatedEntityType = &relatedType.String
			}
			if relatedID.Valid {
				item.RelatedEntityID = &relatedID.String
			}
			if readAt.Valid {
				t := readAt.Time
				item.ReadAt = &t
			}
			items = append(items, item)
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
	rows, err := app.DB.Pool.Query(r.Context(), `
		select id, recipient_id, type, title, message, related_entity_type, related_entity_id, read_at, created_at
		from notifications
		where recipient_id = $1
		order by created_at desc`, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]Notification, 0)
	for rows.Next() {
		var item Notification
		var relatedType sql.NullString
		var relatedID sql.NullString
		var readAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.RecipientID, &item.Type, &item.Title, &item.Message, &relatedType, &relatedID, &readAt, &item.CreatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
			return
		}
		if relatedType.Valid {
			item.RelatedEntityType = &relatedType.String
		}
		if relatedID.Valid {
			item.RelatedEntityID = &relatedID.String
		}
		if readAt.Valid {
			t := readAt.Time
			item.ReadAt = &t
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *App) handleNotificationRead(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	id := chi.URLParam(r, "id")
	const q = `
		update notifications
		set read_at = now()
		where id = $1 and recipient_id = $2
		returning id, recipient_id, type, title, message, related_entity_type, related_entity_id, read_at, created_at`
	var item Notification
	var relatedType sql.NullString
	var relatedID sql.NullString
	var readAt sql.NullTime
	err = app.DB.Pool.QueryRow(r.Context(), q, id, user.ID).Scan(&item.ID, &item.RecipientID, &item.Type, &item.Title, &item.Message, &relatedType, &relatedID, &readAt, &item.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Notification not found"})
		return
	}
	if relatedType.Valid {
		item.RelatedEntityType = &relatedType.String
	}
	if relatedID.Valid {
		item.RelatedEntityID = &relatedID.String
	}
	if readAt.Valid {
		t := readAt.Time
		item.ReadAt = &t
	}
	writeJSON(w, http.StatusOK, item)
}
