package main

import (
	"testing"
	"time"
)

func mustDate(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := parseDateOnly(value)
	if err != nil {
		t.Fatalf("parse date %s: %v", value, err)
	}
	return parsed
}

func testUtilizationBookings(t *testing.T) (time.Time, time.Time, []CapacityBooking) {
	t.Helper()
	start := mustDate(t, "2026-06-01")
	end := mustDate(t, "2026-06-05")
	bookings := []CapacityBooking{
		{ID: "approved-half", StartDate: start, EndDate: end, CapacityPercent: 50, Status: "APPROVED"},
		{ID: "in-progress-half", StartDate: start, EndDate: end, CapacityPercent: 50, Status: "IN_PROGRESS"},
		{ID: "pending-full", StartDate: start, EndDate: end, CapacityPercent: 100, Status: "PENDING"},
		{ID: "completed-full", StartDate: start, EndDate: end, CapacityPercent: 100, Status: "COMPLETED"},
	}
	return start, end, bookings
}

func TestCurrentUtilizationUsesOfficialWorkingDaysOnly(t *testing.T) {
	start, end, bookings := testUtilizationBookings(t)

	booked := calculateBookedWorkingDays(bookings, start, end)
	if booked != 5 {
		t.Fatalf("booked working days = %v, want 5", booked)
	}

	utilization := calculateUtilizationPercentByCommittedCapacity(booked, len(workingDaysInRange(start, end)))
	if utilization != 100 {
		t.Fatalf("utilization = %v, want 100", utilization)
	}
}

func TestHistoricalUtilizationIncludesCompletedWorkingDays(t *testing.T) {
	start, end, bookings := testUtilizationBookings(t)

	booked := calculateHistoricalBookedWorkingDays(bookings, start, end)
	if booked != 10 {
		t.Fatalf("historical booked working days = %v, want 10", booked)
	}

	utilization := calculateUtilizationPercentByCommittedCapacity(booked, len(workingDaysInRange(start, end)))
	if utilization != 200 {
		t.Fatalf("historical utilization = %v, want 200", utilization)
	}
}
