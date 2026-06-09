package main

import (
	"math"
	"sort"
	"time"
)

type CapacityBooking struct {
	ID              string
	BAID            *string
	StartDate       time.Time
	EndDate         time.Time
	CapacityPercent int
	Status          string
}

type CapacityDay struct {
	Date             string `json:"date"`
	ApprovedCapacity int    `json:"approved_capacity"`
	PendingCapacity  int    `json:"pending_capacity"`
	RiskCapacity     int    `json:"risk_capacity"`
}

type RangeCapacity struct {
	Daily               []CapacityDay `json:"daily"`
	MaxApprovedCapacity int           `json:"max_approved_capacity"`
	MaxPendingCapacity  int           `json:"max_pending_capacity"`
	MaxRiskCapacity     int           `json:"max_risk_capacity"`
	HasOverbookRisk     bool          `json:"has_overbook_risk"`
}

func isOfficialCapacityStatus(status string) bool {
	return status == "APPROVED" || status == "IN_PROGRESS"
}

func isUtilizationStatus(status string) bool {
	return status == "APPROVED" || status == "IN_PROGRESS" || status == "COMPLETED"
}

func rangesOverlap(firstStart, firstEnd, secondStart, secondEnd time.Time) bool {
	return !firstStart.After(secondEnd) && !firstEnd.Before(secondStart)
}

func getRangeCapacity(bookings []CapacityBooking, startDate, endDate time.Time, excludeBookingID string) RangeCapacity {
	days := eachDay(startDate, endDate)
	daily := make([]CapacityDay, 0, len(days))
	maxApproved := 0
	maxPending := 0
	maxRisk := 0
	hasRisk := false
	for _, day := range days {
		approved := 0
		pending := 0
		for _, booking := range bookings {
			if excludeBookingID != "" && booking.ID == excludeBookingID {
				continue
			}
			if !rangesOverlap(booking.StartDate, booking.EndDate, day, day) {
				continue
			}
			if isOfficialCapacityStatus(booking.Status) {
				approved += booking.CapacityPercent
			}
			if booking.Status == "PENDING" {
				pending += booking.CapacityPercent
			}
		}
		risk := approved + pending
		if approved > maxApproved {
			maxApproved = approved
		}
		if pending > maxPending {
			maxPending = pending
		}
		if risk > maxRisk {
			maxRisk = risk
		}
		if risk > 100 {
			hasRisk = true
		}
		daily = append(daily, CapacityDay{Date: toDateKey(day), ApprovedCapacity: approved, PendingCapacity: pending, RiskCapacity: risk})
	}
	return RangeCapacity{Daily: daily, MaxApprovedCapacity: maxApproved, MaxPendingCapacity: maxPending, MaxRiskCapacity: maxRisk, HasOverbookRisk: hasRisk}
}

func canApproveCapacity(bookings []CapacityBooking, startDate, endDate time.Time, capacityPercent int, excludeBookingID string) (bool, string, int) {
	current := getRangeCapacity(bookings, startDate, endDate, excludeBookingID)
	blockingDay := ""
	maxAfter := 0
	for _, day := range current.Daily {
		after := day.ApprovedCapacity + capacityPercent
		if after > maxAfter {
			maxAfter = after
		}
		if after > 100 && blockingDay == "" {
			blockingDay = day.Date
		}
	}
	return blockingDay == "", blockingDay, maxAfter
}

func calculateBookedWorkingDays(bookings []CapacityBooking, startDate, endDate time.Time) float64 {
	booked := 0.0
	for _, booking := range bookings {
		if !isUtilizationStatus(booking.Status) {
			continue
		}
		overlapStart := maxDate(booking.StartDate, startDate)
		overlapEnd := minDate(booking.EndDate, endDate)
		if overlapStart.After(overlapEnd) {
			continue
		}
		booked += float64(len(workingDaysInRange(overlapStart, overlapEnd))) * (float64(booking.CapacityPercent) / 100.0)
	}
	return booked
}

func calculateBookingManDays(booking CapacityBooking, startDate, endDate time.Time) float64 {
	overlapStart := maxDate(booking.StartDate, startDate)
	overlapEnd := minDate(booking.EndDate, endDate)
	if overlapStart.After(overlapEnd) {
		return 0
	}
	return float64(len(workingDaysInRange(overlapStart, overlapEnd))) * (float64(booking.CapacityPercent) / 100.0)
}

func calculateUtilizationPercent(bookedManDays float64, availableManDays int) float64 {
	if availableManDays <= 0 {
		return 0
	}
	return round1((bookedManDays / float64(availableManDays)) * 100)
}

func calculateBenchRate(benchCount, totalCount int) float64 {
	if totalCount <= 0 {
		return 0
	}
	return round1((float64(benchCount) / float64(totalCount)) * 100)
}

func classifyCapacity(utilizationPercent float64) string {
	switch {
	case utilizationPercent <= 0:
		return "BENCH"
	case utilizationPercent < 50:
		return "LOW"
	case utilizationPercent < 75:
		return "AVAILABLE"
	case utilizationPercent < 100:
		return "HIGH"
	case utilizationPercent == 100:
		return "FULL"
	default:
		return "OVERBOOKED"
	}
}

func uniqueSortedStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func round1(value float64) float64 {
	return math.Round(value*10) / 10
}

func minDate(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func maxDate(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
