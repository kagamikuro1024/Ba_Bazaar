package main

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type seededBooking struct {
	ID string
}

// seedDay returns midnight-UTC `offset` days from today. All booking dates are
// anchored to "now" so the seed never goes stale (no hard-coded calendar dates).
// Negative = past, 0 = today, positive = future.
func seedDay(offset int) time.Time {
	return normalizeDate(timeNow()).AddDate(0, 0, offset)
}

func seedBookings(ctx context.Context, db *DB, managerID string, pmIDs, baIDs []string, projectIDs map[string]string) ([]seededBooking, error) {
	// Day offsets are relative to today. Status is kept consistent with the
	// dates so it survives syncBookingStatuses():
	//   COMPLETED  -> end < today
	//   IN_PROGRESS-> start <= today <= end
	//   APPROVED   -> start > today
	//   PENDING    -> future (sync never touches PENDING) — so no stale pendings
	base := []struct {
		BAIndex, RequesterIndex int
		ProjectName, Title      string
		StartOff, EndOff        int
		Status, Priority        string
		Capacity                int
	}{
		// --- COMPLETED (past) — the minority, gives history + payroll man-days ---
		{0, 0, "Payment Refund Flow", "Refund analysis sprint", -42, -36, "COMPLETED", "MEDIUM", 50},
		{4, 1, "BI Dashboard", "Quarterly metrics wrap-up", -33, -27, "COMPLETED", "HIGH", 50},
		{1, 2, "Logistics Tracking", "Carrier reconciliation audit", -26, -20, "COMPLETED", "MEDIUM", 100},
		{2, 3, "HR Approval Workflow", "Policy intake notes", -21, -17, "COMPLETED", "LOW", 75},
		{5, 0, "CRM Revamp", "Legacy contact merge review", -18, -12, "COMPLETED", "HIGH", 50},
		{9, 4, "Payment Refund Flow", "Refund reasons catalog", -14, -9, "COMPLETED", "MEDIUM", 50},
		{6, 1, "Mobile Onboarding", "Activation funnel notes", -10, -5, "COMPLETED", "MEDIUM", 75},
		{5, 2, "CRM Revamp", "CRM backlog mapping", -11, -6, "COMPLETED", "MEDIUM", 50},

		// --- IN_PROGRESS (spanning today) — current work ---
		{5, 1, "BI Dashboard", "Executive dashboard build", -3, 6, "IN_PROGRESS", "HIGH", 50},
		{1, 3, "Logistics Tracking", "Shipment exception flow", -2, 5, "IN_PROGRESS", "MEDIUM", 50},
		{4, 0, "CRM Revamp", "CRM pilot backlog grooming", -1, 8, "IN_PROGRESS", "HIGH", 75},
		{10, 2, "Mobile Onboarding", "Onboarding discovery", 0, 9, "IN_PROGRESS", "MEDIUM", 50},

		// --- APPROVED (future) — upcoming confirmed work ---
		{0, 0, "Payment Refund Flow", "Refund SLA redesign", 3, 12, "APPROVED", "HIGH", 75}, // conflict base (BA0)
		{5, 1, "CRM Revamp", "CRM phase 2 rollout", 7, 16, "APPROVED", "URGENT", 100},       // BA5 full in future
		{6, 2, "Logistics Tracking", "Carrier integration analysis", 4, 11, "APPROVED", "HIGH", 50},
		{9, 3, "BI Dashboard", "Fraud analytics model", 5, 14, "APPROVED", "HIGH", 50},
		{11, 4, "HR Approval Workflow", "Approval matrix rewrite", 6, 13, "APPROVED", "MEDIUM", 75},
		{2, 1, "Mobile Onboarding", "KYC copy refresh", 10, 17, "APPROVED", "LOW", 50},
		{4, 0, "BI Dashboard", "Capacity snapshot QA", 14, 21, "APPROVED", "MEDIUM", 50},
		{1, 2, "Payment Refund Flow", "Refund incident triage", 12, 20, "APPROVED", "HIGH", 50},

		// --- PENDING (future) — requests waiting on the manager ---
		{0, 2, "Payment Refund Flow", "Digital Bank Onboarding analysis", 5, 14, "PENDING", "HIGH", 50}, // CONFLICT with BA0 approved 75%
		{3, 1, "CRM Revamp", "Free-capacity request (easily assignable)", 6, 12, "PENDING", "MEDIUM", 50},
		{10, 4, "BI Dashboard", "Executive metrics alignment", 8, 15, "PENDING", "HIGH", 75},
		{2, 0, "HR Approval Workflow", "Regional approval rewrite", 9, 16, "PENDING", "MEDIUM", 50},
		{6, 3, "Mobile Onboarding", "Reactivation path review", 11, 18, "PENDING", "MEDIUM", 50},

		// --- REJECTED (future request, declined) ---
		{8, 3, "CRM Revamp", "Customer profile grooming", 4, 8, "REJECTED", "LOW", 100},
		{11, 1, "HR Approval Workflow", "Duplicate approval request", 6, 10, "REJECTED", "MEDIUM", 50},

		// --- CANCELLED (future booking, called off) ---
		{1, 3, "Logistics Tracking", "Cancelled support request", 3, 7, "CANCELLED", "LOW", 50},
		{4, 1, "Logistics Tracking", "Carrier SLA cleanup (cancelled)", 5, 9, "CANCELLED", "LOW", 50},
	}
	created := make([]seededBooking, 0, len(base)+8)
	for _, item := range base {
		id, err := seedOneBooking(ctx, db, managerID, pmIDs[item.RequesterIndex], baIDs[item.BAIndex], projectIDs[item.ProjectName], item.ProjectName, item.Title, seedDay(item.StartOff), seedDay(item.EndOff), item.Capacity, item.Status, item.Priority, nil, nil)
		if err != nil {
			return nil, err
		}
		created = append(created, seededBooking{ID: id})
	}

	// Action Center demo items — all PENDING, all future (open requests,
	// specific-BA requests, and one needing manager verification).
	inbox := []struct {
		BAIndex                          *int
		RequesterIndex                   int
		ProjectName, Title, Description  string
		Notes                            string
		StartOff, EndOff                 int
		Priority                         string
		Capacity                         int
	}{
		{intPtr(4), 4, "Payment Refund Flow", "Payment Refund Flow", "Portal request for failed refunds and validation updates.", "Requested BA: Bui Phuong Thao", 6, 10, "URGENT", 100},
		{nil, 1, "CRM Revamp", "CRM Revamp", "Open request for dependency mapping and BA assignment.", "BA not assigned yet.", 7, 11, "MEDIUM", 25},
		{nil, 3, "Mobile Onboarding", "Mobile Onboarding", "Open request for onboarding workstream alignment.", "[VERIFY] Needs manager verification before BA assignment.", 8, 15, "MEDIUM", 100},
		{intPtr(3), 0, "CRM Revamp", "Reporting Portal Upgrade", "Specific BA request for portal reporting enhancements.", "Requested BA: Le Dang Khoa", 9, 13, "MEDIUM", 75},
		{intPtr(9), 2, "BI Dashboard", "Data Warehouse Redesign", "Specific BA request for reporting model redesign.", "Requested BA: Nguyen Mai Linh", 10, 16, "HIGH", 25},
		{nil, 0, "Internal Portal", "Internal Portal Expansion", "Open request for shared portal support and BA assignment.", "Pending triage before manager approves.", 12, 19, "MEDIUM", 50},
	}
	for _, item := range inbox {
		var baID *string
		if item.BAIndex != nil {
			baID = &baIDs[*item.BAIndex]
		}
		id, err := seedOneBookingWithDetails(ctx, db, managerID, pmIDs[item.RequesterIndex], baID, projectIDs[item.ProjectName], item.Title, item.Description, stringPtr(item.Notes), seedDay(item.StartOff), seedDay(item.EndOff), item.Capacity, "PENDING", item.Priority)
		if err != nil {
			return nil, err
		}
		created = append(created, seededBooking{ID: id})
	}
	return created, nil
}

func seedOneBooking(ctx context.Context, db *DB, managerID, requesterID, baID, projectID, projectName, title string, start, end time.Time, capacity int, status, priority string, notes, managerComment *string) (string, error) {
	description := fmt.Sprintf("%s for %s.", title, projectName)
	return seedOneBookingWithDetails(ctx, db, managerID, requesterID, stringPtr(baID), projectID, title, description, notes, start, end, capacity, status, priority)
}

func seedOneBookingWithDetails(ctx context.Context, db *DB, managerID, requesterID string, baID *string, projectID, title, description string, notes *string, start, end time.Time, capacity int, status, priority string) (string, error) {
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
		rejectedAt = start.AddDate(0, 0, -1)
	}
	if cancelled {
		cancelReason = "Project scope changed before kickoff."
		cancelledAt = start.AddDate(0, 0, -2)
	}
	if approved {
		managerComment = "Approved in seed data."
		approvedAt = start
	}
	_, err := db.Pool.Exec(ctx, `insert into bookings (id, ba_id, project_id, requester_id, manager_id, title, description, notes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now())`, id, nullableSeedString(baID), projectID, requesterID, managerRef, title, description, nullableSeedString(notes), start, end, capacity, priority, status, rejectReason, cancelReason, managerComment, approvedAt, rejectedAt, cancelledAt)
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
	// Indices map to the base list: 19 = a future PENDING, 11 = a future
	// APPROVED (requester pm0), 25 = a REJECTED (requester pm3).
	if len(bookings) >= 26 {
		_, err := db.Pool.Exec(ctx, `insert into notifications (id, recipient_id, type, title, message, related_entity_type, related_entity_id, created_at) values ($1,$2,'BOOKING_REQUEST_CREATED','New booking request','A pending request needs review.','Booking',$3,now()),($4,$5,'BOOKING_APPROVED','Booking approved','Your request for Payment Refund Flow was approved.','Booking',$6,now()),($7,$8,'BOOKING_REJECTED','Booking rejected','Your CRM request was rejected with a manager reason.','Booking',$9,now())`, uuid.NewString(), managerID, bookings[19].ID, uuid.NewString(), pmIDs[0], bookings[11].ID, uuid.NewString(), pmIDs[3], bookings[25].ID)
		if err != nil {
			return err
		}
	}
	payload := fmt.Sprintf(`{"users":22,"ba_profiles":15,"bookings":%d}`, len(bookings))
	_, err := db.Pool.Exec(ctx, `insert into audit_logs (id, actor_id, action, target_type, target_id, new_value, result, created_at) values ($1,$2,'SEED_DATABASE','Database',$3,$4::jsonb,'SUCCESS',now())`, uuid.NewString(), managerID, managerID, payload)
	return err
}

func nullableSeedString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func intPtr(value int) *int { return &value }
