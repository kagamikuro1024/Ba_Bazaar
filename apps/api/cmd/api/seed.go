package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func mainSeed() error {
	db, err := OpenDBFromEnv()
	if err != nil {
		return err
	}
	defer db.Close()
	ctx := context.Background()

	if err := resetDatabase(ctx, db); err != nil {
		return err
	}

	managerPasswordHash, _ := bcrypt.GenerateFromPassword([]byte("Manager@123"), 10)
	pmPasswordHash, _ := bcrypt.GenerateFromPassword([]byte("Pmpo@123"), 10)
	baPasswordHash, _ := bcrypt.GenerateFromPassword([]byte("Ba@123"), 10)
	adminPasswordHash, _ := bcrypt.GenerateFromPassword([]byte("Admin@123"), 10)

	managerID, err := insertUser(ctx, db, UserSeed{FullName: "Mai Lan Anh", Email: "manager@ba-bazaar.local", Role: "BA_MANAGER", PasswordHash: string(managerPasswordHash), AvatarURL: pravatar(11)})
	if err != nil {
		return err
	}
	if _, err := insertUser(ctx, db, UserSeed{FullName: "Bao Tri Admin", Email: "admin@ba-bazaar.local", Role: "ADMIN", PasswordHash: string(adminPasswordHash), AvatarURL: pravatar(12)}); err != nil {
		return err
	}
	hasITAdminRole, err := enumValueExists(ctx, db, "UserRole", "IT_ADMIN")
	if err != nil {
		return err
	}
	if hasITAdminRole {
		itAdminPasswordHash, _ := bcrypt.GenerateFromPassword([]byte("ItAdmin@123"), 10)
		if _, err := insertUser(ctx, db, UserSeed{FullName: "Bao Tri IT Admin", Email: "it-admin@ba-bazaar.local", Role: "IT_ADMIN", PasswordHash: string(itAdminPasswordHash), AvatarURL: pravatar(13)}); err != nil {
			return err
		}
	} else {
		log.Printf("seed: skipped IT_ADMIN user because local database enum UserRole does not include IT_ADMIN")
	}

	pmNames := []string{"Minh Tran", "Hoa Nguyen", "Quang Pham", "Linh Do", "Khanh Vo"}
	pmIDs := make([]string, 0, len(pmNames))
	for i, name := range pmNames {
		id, err := insertUser(ctx, db, UserSeed{FullName: name, Email: fmt.Sprintf("pm%d@ba-bazaar.local", i+1), Role: "PM_PO", PasswordHash: string(pmPasswordHash), AvatarURL: pravatar(21 + i)})
		if err != nil {
			return err
		}
		pmIDs = append(pmIDs, id)
	}

	tagIDs := map[string]string{}
	for _, item := range []struct{ Name, Group string }{
		{"Fintech", "DOMAIN"},
		{"E-commerce", "DOMAIN"},
		{"Logistics", "DOMAIN"},
		{"HR Tech", "DOMAIN"},
		{"CRM", "DOMAIN"},
		{"BPMN", "ANALYSIS_SKILL"},
		{"User Story Mapping", "ANALYSIS_SKILL"},
		{"Data Analysis", "ANALYSIS_SKILL"},
		{"API Specification", "ANALYSIS_SKILL"},
		{"Stakeholder Workshop", "ANALYSIS_SKILL"},
	} {
		id := uuid.NewString()
		_, err := db.Pool.Exec(ctx, `insert into skill_tags (id, name, "group", status, created_at, updated_at) values ($1, $2, $3, 'ACTIVE', now(), now())`, id, item.Name, item.Group)
		if err != nil {
			return err
		}
		tagIDs[item.Name] = id
	}

	projectIDs := map[string]string{}
	for _, item := range []struct{ Name, Color, Description string }{
		{"Payment Refund Flow", "#2563EB", "Refund and reconciliation workflow"},
		{"Mobile Onboarding", "#16A34A", "Digital onboarding for mobile users"},
		{"CRM Revamp", "#7C3AED", "Internal CRM modernization"},
		{"Logistics Tracking", "#F97316", "Shipment tracking and exception flows"},
		{"BI Dashboard", "#0F766E", "Executive utilization and delivery dashboard"},
		{"HR Approval Workflow", "#DB2777", "People operation request approvals"},
	} {
		id := uuid.NewString()
		_, err := db.Pool.Exec(ctx, `insert into projects (id, name, color, description, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`, id, item.Name, item.Color, item.Description)
		if err != nil {
			return err
		}
		projectIDs[item.Name] = id
	}
	projectIDs["Internal Portal"] = projectIDs["Payment Refund Flow"]

	baInputs := []struct {
		Name       string
		Level      string
		Status     string
		TagNames   []string
		Reason     *string
		StatusDate *time.Time
	}{
		{"Pham Ngoc Chi", "SENIOR", "ACTIVE", []string{"Fintech", "BPMN", "API Specification"}, nil, nil},
		{"Do Anh Dung", "MIDDLE", "ACTIVE", []string{"Logistics", "Data Analysis"}, nil, nil},
		{"Nguyen Bao An", "JUNIOR", "ACTIVE", []string{"HR Tech", "User Story Mapping"}, nil, nil},
		{"Le Dang Khoa", "MIDDLE", "ACTIVE", []string{"CRM", "Stakeholder Workshop"}, nil, nil},
		{"Bui Phuong Thao", "SENIOR", "ACTIVE", []string{"CRM", "Data Analysis"}, nil, nil},
		{"Hoang Minh Chau", "LEAD", "ACTIVE", []string{"Fintech", "CRM", "BPMN"}, nil, nil},
		{"Tran Gia Huy", "MIDDLE", "ACTIVE", []string{"E-commerce", "API Specification"}, nil, nil},
		{"Vo Thanh Tam", "SENIOR", "ACTIVE", []string{"Logistics", "BPMN"}, nil, nil},
		{"Dang Thu Ha", "JUNIOR", "ACTIVE", []string{"CRM", "User Story Mapping"}, nil, nil},
		{"Nguyen Mai Linh", "MIDDLE", "ACTIVE", []string{"Fintech", "Data Analysis"}, nil, nil},
		{"Pham Quoc Bao", "SENIOR", "ACTIVE", []string{"E-commerce", "Stakeholder Workshop"}, nil, nil},
		{"Do Minh Tue", "MIDDLE", "ACTIVE", []string{"HR Tech", "BPMN"}, nil, nil},
		{"Le Hoai Nam", "LEAD", "ON_LEAVE", []string{"CRM", "API Specification"}, stringPtr("Temporary leave"), timePtr(dateOnly("2026-05-20"))},
		{"Vu Nhat Vy", "SENIOR", "ON_LEAVE", []string{"Fintech", "Data Analysis"}, stringPtr("Temporary leave"), timePtr(dateOnly("2026-05-20"))},
		{"Tran Thai Son", "MIDDLE", "RESIGNED", []string{"Logistics", "BPMN"}, stringPtr("Historical profile retained"), timePtr(dateOnly("2026-05-20"))},
	}
	baIDs := make([]string, 0, len(baInputs))
	for i, item := range baInputs {
		userID, err := insertUser(ctx, db, UserSeed{FullName: item.Name, Email: fmt.Sprintf("ba%d@ba-bazaar.local", i+1), Role: "BA", PasswordHash: string(baPasswordHash), AvatarURL: pravatar(41 + i)})
		if err != nil {
			return err
		}
		baID := uuid.NewString()
		joinedDate := fmt.Sprintf("202%d-0%d-15", minInt(i%5, 5), (i%8)+1)
		_, err = db.Pool.Exec(ctx, `insert into ba_profiles (id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, status_reason, status_changed_at, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now(),1)`, baID, userID, item.Name, fmt.Sprintf("ba%d@ba-bazaar.local", i+1), fmt.Sprintf("090%07d", i+1), item.Level, dateOnly(joinedDate), pravatar(41+i), item.Status, item.Reason, item.StatusDate)
		if err != nil {
			return err
		}
		for _, tagName := range item.TagNames {
			_, err = db.Pool.Exec(ctx, `insert into ba_skill_tags (id, ba_id, tag_id, assigned_by, assigned_at) values ($1, $2, $3, $4, now())`, uuid.NewString(), baID, tagIDs[tagName], managerID)
			if err != nil {
				return err
			}
		}
		baIDs = append(baIDs, baID)
	}

	createdBookings, err := seedBookings(ctx, db, managerID, pmIDs, baIDs, projectIDs)
	if err != nil {
		return err
	}
	if err := seedNotesNotificationsAudit(ctx, db, managerID, pmIDs, baIDs, createdBookings); err != nil {
		return err
	}

	hasAiFeatureFlags, err := tableExists(ctx, db, "ai_feature_flags")
	if err != nil {
		return err
	}
	hasAiSettings, err := tableExists(ctx, db, "ai_settings")
	if err != nil {
		return err
	}

	if hasAiFeatureFlags {
		flags := []struct {
			Key, Name, Desc string
			Enabled         bool
		}{
			{"ai_suggest_ba_enabled", "AI Suggest BA", "Gate for Suggest BA feature", true},
			{"ai_prd_skill_extraction_enabled", "PRD Skill Extraction", "Gate for extracting skills from PRD", true},
			{"ai_pmpo_chatbot_enabled", "PM/PO Chatbot", "Gate for future PM/PO chatbot", true},
			{"ai_ba_manager_chatbot_enabled", "BA Manager Chatbot", "Gate for future BA Manager chatbot", true},
			{"ai_dashboard_summary_enabled", "Dashboard Summary", "Gate for LLM dashboard summary", true},
			{"ai_report_summary_enabled", "Report Summary", "Gate for LLM report summary", true},
			{"ai_observability_enabled", "AI Observability logging", "Master switch for logging AI session data", true},
		}
		for _, f := range flags {
			_, err = db.Pool.Exec(ctx, `
				insert into ai_feature_flags (id, key, name, description, enabled, environment, updated_at)
				values ($1, $2, $3, $4, $5, 'all', now())
			`, uuid.NewString(), f.Key, f.Name, f.Desc, f.Enabled)
			if err != nil {
				return fmt.Errorf("seed flags: %w", err)
			}
		}
	}

	if hasAiSettings {
		settings := []struct {
			Key, Value, Desc string
		}{
			{"ai_model_name", "deepseek-chat", "Primary LLM model name used for AI features"},
			{"ai_temperature", "0.2", "Temperature parameter for AI generation"},
			{"ai_prompt_version", "v1.0.0", "Active prompt version tag for logging"},
		}
		for _, s := range settings {
			_, err = db.Pool.Exec(ctx, `
				insert into ai_settings (id, key, value, description, updated_at)
				values ($1, $2, $3, $4, now())
			`, uuid.NewString(), s.Key, s.Value, s.Desc)
			if err != nil {
				return fmt.Errorf("seed settings: %w", err)
			}
		}
	}

	if !hasAiFeatureFlags || !hasAiSettings {
		log.Printf("seed: skipped AI defaults because local database is missing AI observability tables")
	}

	log.Printf("seeded users=%d ba_profiles=%d projects=%d tags=%d bookings=%d", 22, len(baIDs), len(projectIDs), len(tagIDs), len(createdBookings))
	return nil
}

type UserSeed struct {
	FullName     string
	Email        string
	Role         string
	PasswordHash string
	AvatarURL    string
}

func insertUser(ctx context.Context, db *DB, input UserSeed) (string, error) {
	id := uuid.NewString()
	_, err := db.Pool.Exec(ctx, `insert into users (id, full_name, email, role, password_hash, avatar_url, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,now(),now())`, id, input.FullName, input.Email, input.Role, input.PasswordHash, input.AvatarURL)
	return id, err
}

func resetDatabase(ctx context.Context, db *DB) error {
	tables := []string{
		"audit_logs", "notifications", "private_notes", "bookings",
		"ba_skill_tags", "skill_tags", "projects", "ba_profiles",
		"refresh_tokens", "users",
	}

	optionalTables := []string{
		"ai_settings", "ai_feature_flags", "ai_feedback", "ai_errors",
		"ai_tool_calls", "ai_extractions", "ai_messages", "ai_sessions",
	}

	for _, table := range optionalTables {
		exists, err := tableExists(ctx, db, table)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if _, err := db.Pool.Exec(ctx, "delete from "+table); err != nil {
			return err
		}
	}

	for _, table := range tables {
		if _, err := db.Pool.Exec(ctx, "delete from "+table); err != nil {
			return err
		}
	}
	return nil
}

func pravatar(imageID int) string { return fmt.Sprintf("https://i.pravatar.cc/300?img=%d", imageID) }
func dateOnly(value string) time.Time {
	t, _ := time.Parse("2006-01-02", value)
	return t.UTC()
}
func stringPtr(value string) *string { return &value }
func timePtr(value time.Time) *time.Time { return &value }
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func tableExists(ctx context.Context, db *DB, tableName string) (bool, error) {
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.tables
			where table_schema = 'public' and table_name = $1
		)
	`, tableName).Scan(&exists)
	return exists, err
}

func enumValueExists(ctx context.Context, db *DB, enumName string, enumValue string) (bool, error) {
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		select exists (
			select 1
			from pg_type t
			join pg_enum e on e.enumtypid = t.oid
			where t.typname = $1 and e.enumlabel = $2
		)
	`, enumName, enumValue).Scan(&exists)
	return exists, err
}

func init() {
	if len(os.Args) > 1 && os.Args[1] == "seed" {
		if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
			os.Setenv("DATABASE_URL", resolveLocalDatabaseURL())
		}
		if err := mainSeed(); err != nil {
			log.Fatal(err)
		}
		os.Exit(0)
	}
}

func normalizeDSN(dsn string) string {
	parsed, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	q := parsed.Query()
	q.Del("schema")
	parsed.RawQuery = q.Encode()
	return parsed.String()
}
