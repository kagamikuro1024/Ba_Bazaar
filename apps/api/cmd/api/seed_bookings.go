package main

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type seededBooking struct {
	ID string
}

func seedBookings(ctx context.Context, db *DB, managerID string, pmIDs, baIDs []string, projectIDs map[string]string) ([]seededBooking, error) {
	base := []struct {
		BAIndex, RequesterIndex int
		ProjectName, Title, StartDate, EndDate, Status, Priority string
		Capacity int
	}{
		{0, 0, "Payment Refund Flow", "Refund analysis sprint", "2026-06-01", "2026-06-05", "APPROVED", "HIGH", 50},
		{0, 1, "CRM Revamp", "Pending CRM dependency mapping", "2026-06-03", "2026-06-06", "PENDING", "MEDIUM", 25},
		{1, 1, "Logistics Tracking", "Shipment exception flow", "2026-06-01", "2026-06-06", "APPROVED", "HIGH", 100},
		{2, 2, "HR Approval Workflow", "HR request rules", "2026-06-03", "2026-06-04", "APPROVED", "LOW", 75},
		{4, 3, "BI Dashboard", "Dashboard requirements", "2026-06-01", "2026-06-05", "APPROVED", "MEDIUM", 50},
		{4, 4, "Internal Portal", "Portal request risk", "2026-06-01", "2026-06-06", "PENDING", "URGENT", 100},
		{5, 0, "CRM Revamp", "Lead BA CRM review", "2026-06-02", "2026-06-07", "IN_PROGRESS", "HIGH", 100},
		{6, 1, "Mobile Onboarding", "Onboarding discovery", "2026-06-09", "2026-06-13", "PENDING", "MEDIUM", 50},
		{7, 2, "Logistics Tracking", "Carrier integration analysis", "2026-06-10", "2026-06-14", "APPROVED", "HIGH", 50},
		{8, 3, "CRM Revamp", "Customer profile grooming", "2026-06-09", "2026-06-10", "REJECTED", "LOW", 100},
		{10, 1, "BI Dashboard", "Completed onboarding metric wrap-up", "2026-06-02", "2026-06-03", "COMPLETED", "MEDIUM", 50},
		{8, 1, "Internal Portal", "Portal backlog walkthrough", "2026-05-21", "2026-05-23", "COMPLETED", "MEDIUM", 50},
		{8, 4, "BI Dashboard", "CRM metrics mapping", "2026-05-12", "2026-05-16", "COMPLETED", "HIGH", 50},
		{8, 0, "Payment Refund Flow", "Refund contact-center scenarios", "2026-04-22", "2026-04-25", "COMPLETED", "MEDIUM", 50},
		{8, 2, "Mobile Onboarding", "Onboarding support fallback", "2026-04-08", "2026-04-10", "CANCELLED", "LOW", 50},
		{8, 1, "HR Approval Workflow", "Policy intake notes", "2026-03-17", "2026-03-20", "COMPLETED", "LOW", 50},
		{8, 0, "CRM Revamp", "Legacy contact merge review", "2026-02-10", "2026-02-13", "COMPLETED", "MEDIUM", 50},
		{8, 2, "Logistics Tracking", "Returned-order exception analysis", "2026-01-19", "2026-01-23", "COMPLETED", "HIGH", 100},
		{8, 4, "Payment Refund Flow", "Refund SLA gap mapping", "2025-12-08", "2025-12-12", "COMPLETED", "MEDIUM", 50},
		{8, 3, "BI Dashboard", "Retention metrics workshop", "2025-11-17", "2025-11-21", "COMPLETED", "HIGH", 100},
		{8, 1, "Internal Portal", "Service request taxonomy cleanup", "2025-10-06", "2025-10-10", "COMPLETED", "LOW", 50},
		{8, 0, "CRM Revamp", "Lead intake form simplification", "2025-09-15", "2025-09-19", "COMPLETED", "HIGH", 100},
		{8, 4, "HR Approval Workflow", "Escalation ladder discovery", "2025-08-11", "2025-08-15", "COMPLETED", "MEDIUM", 50},
		{8, 2, "Mobile Onboarding", "Activation funnel notes", "2025-07-07", "2025-07-11", "COMPLETED", "MEDIUM", 100},
		{8, 3, "Payment Refund Flow", "Refund reasons catalog", "2025-06-09", "2025-06-13", "COMPLETED", "LOW", 50},
		{8, 1, "BI Dashboard", "Customer health score definition", "2025-05-12", "2025-05-16", "COMPLETED", "HIGH", 100},
		{8, 4, "CRM Revamp", "Duplicate profile cleanup rules", "2025-04-14", "2025-04-18", "COMPLETED", "MEDIUM", 50},
		{9, 4, "Payment Refund Flow", "Refund report review", "2026-06-11", "2026-06-15", "APPROVED", "MEDIUM", 50},
		{10, 0, "Mobile Onboarding", "KYC rules", "2026-06-16", "2026-06-20", "PENDING", "URGENT", 100},
		{11, 1, "HR Approval Workflow", "Approval matrix", "2026-06-16", "2026-06-18", "APPROVED", "MEDIUM", 50},
		{0, 2, "Payment Refund Flow", "Completed refund baseline", "2026-05-04", "2026-05-08", "COMPLETED", "MEDIUM", 50},
		{1, 3, "Logistics Tracking", "Cancelled logistics support", "2026-05-11", "2026-05-13", "CANCELLED", "LOW", 50},
		{2, 4, "HR Approval Workflow", "Completed HR interviews", "2026-05-18", "2026-05-22", "COMPLETED", "HIGH", 100},
		{3, 0, "CRM Revamp", "Free-capacity pending demo", "2026-06-04", "2026-06-10", "PENDING", "HIGH", 50},
		{5, 1, "BI Dashboard", "Approved full capacity block", "2026-06-10", "2026-06-14", "APPROVED", "URGENT", 100},
		{5, 2, "Mobile Onboarding", "Should be blocked if approved", "2026-06-11", "2026-06-12", "PENDING", "HIGH", 50},
		{12, 3, "CRM Revamp", "Historical on-leave booking", "2026-05-01", "2026-05-03", "COMPLETED", "LOW", 50},
		{14, 4, "Logistics Tracking", "Historical resigned BA booking", "2026-04-01", "2026-04-05", "COMPLETED", "MEDIUM", 100},
	}
	created := make([]seededBooking, 0, len(base)+6)
	for _, item := range base {
		id, err := seedOneBooking(ctx, db, managerID, pmIDs[item.RequesterIndex], baIDs[item.BAIndex], projectIDs[item.ProjectName], item.ProjectName, item.Title, item.StartDate, item.EndDate, item.Capacity, item.Status, item.Priority, nil, nil)
		if err != nil {
			return nil, err
		}
		created = append(created, seededBooking{ID: id})
	}
	inbox := []struct {
		BAIndex *int
		RequesterIndex int
		ProjectName, Title, Description, Notes, StartDate, EndDate, Priority string
		Capacity int
	}{
		{intPtr(4), 4, "Payment Refund Flow", "Payment Refund Flow", "Portal request for failed refunds and validation updates.", "Requested BA: Bui Phuong Thao", "2026-06-01", "2026-06-05", "URGENT", 100},
		{nil, 1, "CRM Revamp", "CRM Revamp", "Open request for dependency mapping and BA assignment.", "BA not assigned yet.", "2026-06-03", "2026-06-06", "MEDIUM", 25},
		{nil, 3, "Mobile Onboarding", "Mobile Onboarding", "Open request for onboarding workstream alignment.", "[VERIFY] Needs manager verification before BA assignment.", "2026-06-05", "2026-06-12", "MEDIUM", 100},
		{intPtr(3), 0, "CRM Revamp", "Reporting Portal Upgrade", "Specific BA request for portal reporting enhancements.", "Requested BA: Le Dang Khoa", "2026-06-07", "2026-06-11", "MEDIUM", 75},
		{intPtr(9), 2, "BI Dashboard", "Data Warehouse Redesign", "Specific BA request for reporting model redesign.", "Requested BA: Nguyen Mai Linh", "2026-06-08", "2026-06-13", "HIGH", 25},
		{nil, 2, "BI Dashboard", "Analytics Dashboard", "Open request for analytics dashboard discovery.", "Needs BA assignment.", "2026-06-09", "2026-06-13", "HIGH", 50},
	}
	for _, item := range inbox {
		var baID *string
		if item.BAIndex != nil {
			baID = &baIDs[*item.BAIndex]
		}
		id, err := seedOneBookingWithDetails(ctx, db, managerID, pmIDs[item.RequesterIndex], baID, projectIDs[item.ProjectName], item.Title, item.Description, stringPtr(item.Notes), item.StartDate, item.EndDate, item.Capacity, "PENDING", item.Priority)
		if err != nil {
			return nil, err
		}
		created = append(created, seededBooking{ID: id})
	}
	return created, nil
}

func seedOneBooking(ctx context.Context, db *DB, managerID, requesterID, baID, projectID, projectName, title, startDate, endDate string, capacity int, status, priority string, notes, managerComment *string) (string, error) {
	description := fmt.Sprintf("%s for %s.", title, projectName)
	return seedOneBookingWithDetails(ctx, db, managerID, requesterID, stringPtr(baID), projectID, title, description, notes, startDate, endDate, capacity, status, priority)
}

func seedOneBookingWithDetails(ctx context.Context, db *DB, managerID, requesterID string, baID *string, projectID, title, description string, notes *string, startDate, endDate string, capacity int, status, priority string) (string, error) {
	id := uuid.NewString()
	approved := status == "APPROVED" || status == "IN_PROGRESS" || status == "COMPLETED"
	rejected := status == "REJECTED"
	cancelled := status == "CANCELLED"
	var managerRef any
	if approved || rejected || cancelled {
		managerRef = managerID
	}
	var rejectReason, cancelReason, managerComment any
	var approvedAt, rejectedAt, cancelledAt any
	if rejected {
		rejectReason = "BA has conflicting priority work in this period."
		rejectedAt = dateOnly("2026-06-01")
	}
	if cancelled {
		cancelReason = "Project scope changed before kickoff."
		cancelledAt = dateOnly("2026-05-10")
	}
	if approved {
		managerComment = "Approved in seed data."
		approvedAt = dateOnly(startDate)
	}
	_, err := db.Pool.Exec(ctx, `insert into bookings (id, ba_id, project_id, requester_id, manager_id, title, description, notes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now())`, id, nullableSeedString(baID), projectID, requesterID, managerRef, title, description, nullableSeedString(notes), dateOnly(startDate), dateOnly(endDate), capacity, priority, status, rejectReason, cancelReason, managerComment, approvedAt, rejectedAt, cancelledAt)
	return id, err
}

func seedNotesNotificationsAudit(ctx context.Context, db *DB, managerID string, pmIDs, baIDs []string, bookings []seededBooking) error {
	notes := []string{
		"Strong stakeholder facilitation, good fit for discovery-heavy work.",
		"Prefers clear acceptance criteria before sprint planning.",
		"Recently mentored junior BA on BPMN modeling.",
		"Watch workload near quarter end due reporting commitments.",
		"Good candidate for API-heavy projects.",
	}
	for i, note := range notes {
		_, err := db.Pool.Exec(ctx, `insert into private_notes (id, ba_id, content, created_by, created_at, visibility) values ($1,$2,$3,$4,now(),'MANAGER_ONLY')`, uuid.NewString(), baIDs[i], note, managerID)
		if err != nil {
			return err
		}
	}
	if len(bookings) > 9 {
		_, err := db.Pool.Exec(ctx, `insert into notifications (id, recipient_id, type, title, message, related_entity_type, related_entity_id, created_at) values ($1,$2,'BOOKING_REQUEST_CREATED','New booking request','A pending request needs review.','Booking',$3,now()),($4,$5,'BOOKING_APPROVED','Booking approved','Your request for Payment Refund Flow was approved.','Booking',$6,now()),($7,$8,'BOOKING_REJECTED','Booking rejected','Your CRM request was rejected with a manager reason.','Booking',$9,now())`, uuid.NewString(), managerID, bookings[1].ID, uuid.NewString(), pmIDs[0], bookings[0].ID, uuid.NewString(), pmIDs[3], bookings[9].ID)
		if err != nil {
			return err
		}
	}
	payload := fmt.Sprintf(`{"users":21,"ba_profiles":15,"bookings":%d}`, len(bookings))
	_, err := db.Pool.Exec(ctx, `insert into audit_logs (id, actor_id, action, target_type, target_id, new_value, result, created_at) values ($1,$2,'SEED_DATABASE','Database',$2,$3::jsonb,'SUCCESS',now())`, uuid.NewString(), managerID, payload)
	return err
}

func nullableSeedString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func intPtr(value int) *int { return &value }
