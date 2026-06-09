package main

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type BAProfile struct {
	ID              string           `json:"id"`
	UserID          *string          `json:"user_id"`
	FullName        string           `json:"full_name"`
	Email           string           `json:"email"`
	Phone           *string          `json:"phone"`
	Level           string           `json:"level"`
	JoinedDate      time.Time        `json:"joined_date"`
	AvatarURL       *string          `json:"avatar_url"`
	Status          string           `json:"status"`
	StatusReason    *string          `json:"status_reason"`
	StatusChangedAt *time.Time       `json:"status_changed_at"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
	Version         int              `json:"version"`
	SkillTags       []BAProfileTag   `json:"skill_tags,omitempty"`
}

type BAProfileTag struct {
	ID  string   `json:"id"`
	Tag SkillTag `json:"tag"`
}

type BAListItem struct {
	BAProfile
	Timeframe          map[string]string `json:"timeframe"`
	ApprovedCapacity   int               `json:"approved_capacity"`
	PendingCapacity    int               `json:"pending_capacity"`
	RiskCapacity       int               `json:"risk_capacity"`
	BookedManDays      float64           `json:"booked_man_days"`
	AvailableManDays   int               `json:"available_man_days"`
	UtilizationPercent float64           `json:"utilization_percent"`
	CapacityLabel      string            `json:"capacity_label"`
	CurrentProjects    []map[string]any  `json:"current_projects"`
}

type Booking struct {
	ID              string      `json:"id"`
	BAID            *string     `json:"ba_id"`
	ProjectID       string      `json:"project_id"`
	RequesterID     string      `json:"requester_id"`
	ManagerID       *string     `json:"manager_id"`
	Title           string      `json:"title"`
	Description     string      `json:"description"`
	Notes           *string     `json:"notes"`
	PendingChanges  any         `json:"pending_changes"`
	StartDate       time.Time   `json:"start_date"`
	EndDate         time.Time   `json:"end_date"`
	CapacityPercent int         `json:"capacity_percent"`
	Priority        string      `json:"priority"`
	Status          string      `json:"status"`
	RejectReason    *string     `json:"reject_reason"`
	CancelReason    *string     `json:"cancel_reason"`
	ManagerComment  *string     `json:"manager_comment"`
	ApprovedAt      *time.Time  `json:"approved_at"`
	RejectedAt      *time.Time  `json:"rejected_at"`
	CancelledAt     *time.Time  `json:"cancelled_at"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
	BA              *BAProfile  `json:"ba,omitempty"`
	Project         *Project    `json:"project,omitempty"`
	Requester       *User       `json:"requester,omitempty"`
	Manager         *User       `json:"manager,omitempty"`
}

func scanBAProfile(scanner interface{ Scan(dest ...any) error }) (*BAProfile, error) {
	var item BAProfile
	var userID, phone, avatar, statusReason sql.NullString
	var statusChanged sql.NullTime
	err := scanner.Scan(&item.ID, &userID, &item.FullName, &item.Email, &phone, &item.Level, &item.JoinedDate, &avatar, &item.Status, &statusReason, &statusChanged, &item.CreatedAt, &item.UpdatedAt, &item.Version)
	if err != nil {
		return nil, err
	}
	if userID.Valid {
		item.UserID = &userID.String
	}
	if phone.Valid {
		item.Phone = &phone.String
	}
	if avatar.Valid {
		item.AvatarURL = &avatar.String
	}
	if statusReason.Valid {
		item.StatusReason = &statusReason.String
	}
	if statusChanged.Valid {
		t := statusChanged.Time
		item.StatusChangedAt = &t
	}
	return &item, nil
}

func fetchSkillTagsForBA(ctx DBTX, baID string) ([]BAProfileTag, error) {
	rows, err := ctx.Query(ctxContext(ctx), `
		select bst.id, st.id, st.name, st."group", st.status, st.created_at, st.updated_at
		from ba_skill_tags bst
		join skill_tags st on st.id = bst.tag_id
		where bst.ba_id = $1
		order by st."group" asc, st.name asc`, baID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]BAProfileTag, 0)
	for rows.Next() {
		var item BAProfileTag
		if err := rows.Scan(&item.ID, &item.Tag.ID, &item.Tag.Name, &item.Tag.Group, &item.Tag.Status, &item.Tag.CreatedAt, &item.Tag.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type DBTX interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func ctxContext(tx DBTX) context.Context { return context.Background() }

func safeNullString(value sql.NullString) *string {
	if value.Valid {
		return &value.String
	}
	return nil
}

func placeholders(start, count int) string {
	parts := make([]string, 0, count)
	for i := 0; i < count; i++ {
		parts = append(parts, fmt.Sprintf("$%d", start+i))
	}
	return strings.Join(parts, ",")
}
