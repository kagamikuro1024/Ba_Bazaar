package main

import "testing"

// helper: build a CapacityBooking from date strings.
func capBooking(t *testing.T, id, status string, start, end string, capacity int) CapacityBooking {
	t.Helper()
	return CapacityBooking{
		ID:              id,
		StartDate:       mustDate(t, start),
		EndDate:         mustDate(t, end),
		CapacityPercent: capacity,
		Status:          status,
	}
}

// Plan 10.2: approving a request that pushes a BA past 100% on an overlapping
// working day must be blocked, and the suggested max capacity must bring the
// total back to exactly 100%.
func TestApproveConflictBlockedWithSuggestedMax(t *testing.T) {
	existing := []CapacityBooking{
		capBooking(t, "approved-70", "APPROVED", "2026-06-01", "2026-06-10", 70),
	}

	reqStart := mustDate(t, "2026-06-05")
	reqEnd := mustDate(t, "2026-06-12")

	allowed, blockingDay, maxAfter := canApproveCapacity(existing, reqStart, reqEnd, 50, "")
	if allowed {
		t.Fatalf("expected approval to be blocked (70%% + 50%% = 120%%)")
	}
	if blockingDay == "" {
		t.Fatalf("expected a blocking day to be reported")
	}
	if maxAfter != 120 {
		t.Fatalf("maxAfter = %d, want 120", maxAfter)
	}

	day, existingApproved, suggestedMax := approveConflictDetail(existing, reqStart, reqEnd, 50, "")
	if existingApproved != 70 {
		t.Fatalf("existingApproved = %d, want 70", existingApproved)
	}
	if suggestedMax != 30 {
		t.Fatalf("suggestedMax = %d, want 30 (70 + 30 = 100)", suggestedMax)
	}
	if day != "2026-06-05" {
		t.Fatalf("blocking day = %q, want 2026-06-05", day)
	}
}

// Plan 10.3 control: reducing the request so the total lands on 100% is allowed.
func TestApproveAllowedWhenTotalAtHundred(t *testing.T) {
	existing := []CapacityBooking{
		capBooking(t, "approved-70", "APPROVED", "2026-06-01", "2026-06-10", 70),
	}
	allowed, _, maxAfter := canApproveCapacity(existing, mustDate(t, "2026-06-05"), mustDate(t, "2026-06-12"), 30, "")
	if !allowed {
		t.Fatalf("expected approval to be allowed (70%% + 30%% = 100%%)")
	}
	if maxAfter != 100 {
		t.Fatalf("maxAfter = %d, want 100", maxAfter)
	}
}

// A pending request that would exceed 100% if approved is a CONFLICT RISK, not
// an overbooked allocation: approved capacity stays valid (<=100) while risk
// (approved + pending) goes over.
func TestPendingOverlapIsConflictNotInvalid(t *testing.T) {
	bookings := []CapacityBooking{
		capBooking(t, "approved-70", "APPROVED", "2026-06-01", "2026-06-10", 70),
		capBooking(t, "pending-50", "PENDING", "2026-06-05", "2026-06-12", 50),
	}
	rc := getRangeCapacity(bookings, mustDate(t, "2026-06-01"), mustDate(t, "2026-06-12"), "")

	invalidOverbook := rc.MaxApprovedCapacity > 100
	conflictRisk := rc.MaxRiskCapacity > 100 && !invalidOverbook

	if rc.MaxApprovedCapacity != 70 {
		t.Fatalf("max approved = %d, want 70", rc.MaxApprovedCapacity)
	}
	if rc.MaxRiskCapacity != 120 {
		t.Fatalf("max risk = %d, want 120", rc.MaxRiskCapacity)
	}
	if invalidOverbook {
		t.Fatalf("pending overlap must NOT be flagged as invalid overbook")
	}
	if !conflictRisk {
		t.Fatalf("pending overlap pushing past 100%% must be flagged as conflict risk")
	}
}

// Two APPROVED bookings overlapping past 100% is the only real "overbook": it is
// invalid data (the approve guard normally prevents it) and must NOT be reported
// as a mere pending conflict.
func TestApprovedOverlapIsInvalidOverbook(t *testing.T) {
	bookings := []CapacityBooking{
		capBooking(t, "approved-70", "APPROVED", "2026-06-01", "2026-06-10", 70),
		capBooking(t, "approved-50", "APPROVED", "2026-06-05", "2026-06-12", 50),
	}
	rc := getRangeCapacity(bookings, mustDate(t, "2026-06-01"), mustDate(t, "2026-06-12"), "")

	invalidOverbook := rc.MaxApprovedCapacity > 100
	conflictRisk := rc.MaxRiskCapacity > 100 && !invalidOverbook

	if !invalidOverbook {
		t.Fatalf("two approved bookings over 100%% must be invalid overbook (max approved = %d)", rc.MaxApprovedCapacity)
	}
	if conflictRisk {
		t.Fatalf("an invalid overbook must not also be reported as a conflict risk")
	}
}

// classifyCapacity is driven by approved man-day utilization only. It returns
// OVERBOOKED solely when utilization exceeds 100% (a data issue), never for
// pending risk.
func TestClassifyCapacityByUtilization(t *testing.T) {
	cases := []struct {
		utilization float64
		want        string
	}{
		{0, "BENCH"},
		{30, "LOW"},
		{60, "AVAILABLE"},
		{80, "HIGH"},
		{100, "FULL"},
		{120, "OVERBOOKED"},
	}
	for _, tc := range cases {
		if got := classifyCapacity(tc.utilization); got != tc.want {
			t.Fatalf("classifyCapacity(%v) = %q, want %q", tc.utilization, got, tc.want)
		}
	}
}

// Plan 10.7: a Friday-to-Monday booking only spends 2 working days (weekend
// excluded), so a 100% booking is 2 man-days, not 4.
func TestWeekendExcludedFromManDays(t *testing.T) {
	booking := capBooking(t, "fri-mon", "APPROVED", "2026-06-05", "2026-06-08", 100) // Fri..Mon
	manDays := calculateBookingManDays(booking, mustDate(t, "2026-06-05"), mustDate(t, "2026-06-08"))
	if manDays != 2 {
		t.Fatalf("man-days = %v, want 2 (Fri + Mon only)", manDays)
	}
}

// Plan 10.5: a week with 5 working days and a 5-day 50% booking is 2.5 man-days
// => 50% utilization.
func TestWeekUtilizationHalfCapacity(t *testing.T) {
	start := mustDate(t, "2026-06-01") // Monday
	end := mustDate(t, "2026-06-05")   // Friday
	booking := capBooking(t, "wk-50", "APPROVED", "2026-06-01", "2026-06-05", 50)

	manDays := calculateBookingManDays(booking, start, end)
	if manDays != 2.5 {
		t.Fatalf("man-days = %v, want 2.5", manDays)
	}
	utilization := calculateUtilizationPercent(manDays, len(workingDaysInRange(start, end)))
	if utilization != 50 {
		t.Fatalf("utilization = %v, want 50", utilization)
	}
}

// Plan 10.6: 11 allocated man-days over a 22 working-day month => 50%.
func TestMonthUtilizationFormula(t *testing.T) {
	if got := calculateUtilizationPercent(11, 22); got != 50 {
		t.Fatalf("utilization = %v, want 50", got)
	}
}
