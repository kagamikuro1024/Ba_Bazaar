package main

import (
	"reflect"
	"testing"
)

func TestBuildCapacityRangeExplanation_Safe(t *testing.T) {
	got := buildCapacityRangeExplanation(nil)

	if got["risk_level"] != "SAFE" {
		t.Fatalf("risk_level = %v, want SAFE", got["risk_level"])
	}
	if got["summary"] != "No overbook risk detected for the selected BA and date range." {
		t.Fatalf("unexpected summary: %v", got["summary"])
	}

	riskDays, ok := got["risk_days"].([]capacityExplanationDay)
	if !ok {
		t.Fatalf("risk_days type = %T, want []capacityExplanationDay", got["risk_days"])
	}
	if len(riskDays) != 0 {
		t.Fatalf("risk_days len = %d, want 0", len(riskDays))
	}

	actions, ok := got["suggested_actions"].([]string)
	if !ok {
		t.Fatalf("suggested_actions type = %T, want []string", got["suggested_actions"])
	}
	wantActions := []string{
		"Submit the request as planned.",
		"Keep monitoring pending requests before approval.",
	}
	if !reflect.DeepEqual(actions, wantActions) {
		t.Fatalf("suggested_actions = %#v, want %#v", actions, wantActions)
	}
}

func TestBuildCapacityRangeExplanation_OverbookRisk(t *testing.T) {
	riskDays := []capacityExplanationDay{
		{
			Date:              "2026-06-10",
			ApprovedCapacity:  75,
			PendingCapacity:   25,
			RiskCapacity:      100,
			RequestedCapacity: 50,
			RiskAfterRequest:  150,
			OverflowCapacity:  50,
		},
		{
			Date:              "2026-06-11",
			ApprovedCapacity:  50,
			PendingCapacity:   25,
			RiskCapacity:      75,
			RequestedCapacity: 50,
			RiskAfterRequest:  125,
			OverflowCapacity:  25,
		},
	}

	got := buildCapacityRangeExplanation(riskDays)

	if got["risk_level"] != "OVERBOOK_RISK" {
		t.Fatalf("risk_level = %v, want OVERBOOK_RISK", got["risk_level"])
	}
	if got["summary"] != "Capacity reaches 150% once this request is included, peaking on 2026-06-10." {
		t.Fatalf("unexpected summary: %v", got["summary"])
	}

	why, ok := got["why_flagged"].([]string)
	if !ok {
		t.Fatalf("why_flagged type = %T, want []string", got["why_flagged"])
	}
	wantWhy := []string{
		"2026-06-10 already carries 100% at-risk load before this request.",
		"Adding 50% pushes the BA to 150%, which is 50% over capacity.",
		"Pending requests are counted so managers can resolve conflicts before approving work.",
	}
	if !reflect.DeepEqual(why, wantWhy) {
		t.Fatalf("why_flagged = %#v, want %#v", why, wantWhy)
	}

	actions, ok := got["suggested_actions"].([]string)
	if !ok {
		t.Fatalf("suggested_actions type = %T, want []string", got["suggested_actions"])
	}
	wantActions := []string{
		"Reduce the requested capacity or split the booking across fewer days.",
		"Move the request to dates with lower pending or approved load.",
		"Assign a different BA with more headroom in the same window.",
		"Review and reject lower-priority pending requests before approving this one.",
	}
	if !reflect.DeepEqual(actions, wantActions) {
		t.Fatalf("suggested_actions = %#v, want %#v", actions, wantActions)
	}
}
