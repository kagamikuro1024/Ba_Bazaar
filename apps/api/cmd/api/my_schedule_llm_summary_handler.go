package main

import (
	"fmt"
	"net/http"
	"time"
)

// ============================================================================
// GET /api/bookings/my-schedule/llm-summary
//
// Grounded AI summary for a BA's own dashboard / My Schedule: what am I on
// now, what starts next, how loaded am I this week and next, and am I at
// overbook risk. Cached per BA by data fingerprint.
// ============================================================================

func (app *App) handleMyScheduleLLMSummary(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	ba, err := app.baProfileByUserID(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "BA profile not found for current user"})
		return
	}
	_ = app.syncBookingStatuses(r.Context())

	bookings, err := app.queryBookings(r.Context(), `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where ba_id = $1 and status in ('APPROVED','IN_PROGRESS','PENDING') order by start_date asc`, ba.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	now := normalizeDate(time.Now().UTC())
	today := toDateKey(now)

	current := make([]myScheduleAssignmentFact, 0, 4)
	upcoming := make([]myScheduleAssignmentFact, 0, 4)
	capRows := make([]CapacityBooking, 0, len(bookings))
	for _, booking := range bookings {
		capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
		if booking.Status == "PENDING" {
			continue // pending requests are not the BA's confirmed work
		}
		fact := myScheduleAssignmentFact{
			Title:           booking.Title,
			StartDate:       toDateKey(booking.StartDate),
			EndDate:         toDateKey(booking.EndDate),
			CapacityPercent: booking.CapacityPercent,
		}
		if booking.Project != nil {
			fact.Project = booking.Project.Name
		}
		if booking.Requester != nil {
			fact.Requester = booking.Requester.FullName
		}
		startKey := toDateKey(booking.StartDate)
		endKey := toDateKey(booking.EndDate)
		switch {
		case startKey <= today && endKey >= today:
			fact.DaysRemaining = int(normalizeDate(booking.EndDate).Sub(now).Hours()/24) + 1
			if len(current) < 4 {
				current = append(current, fact)
			}
		case startKey > today:
			fact.StartsInDays = int(normalizeDate(booking.StartDate).Sub(now).Hours() / 24)
			if len(upcoming) < 4 {
				upcoming = append(upcoming, fact)
			}
		}
	}

	// Week loads from the capacity engine (approved/in-progress only for the
	// confirmed load; risk includes pending).
	thisWeekStart, thisWeekEnd := weekBounds(now)
	nextWeekStart, nextWeekEnd := weekBounds(now.AddDate(0, 0, 7))
	thisWeek := getRangeCapacity(capRows, thisWeekStart, thisWeekEnd, "")
	nextWeek := getRangeCapacity(capRows, nextWeekStart, nextWeekEnd, "")

	overbookWarning := ""
	if thisWeek.MaxApprovedCapacity > 100 {
		overbookWarning = fmt.Sprintf("overbooked this week at %d%%", thisWeek.MaxApprovedCapacity)
	} else if nextWeek.MaxApprovedCapacity > 100 {
		overbookWarning = fmt.Sprintf("overbooked next week at %d%%", nextWeek.MaxApprovedCapacity)
	} else if thisWeek.MaxRiskCapacity > 100 || nextWeek.MaxRiskCapacity > 100 {
		overbookWarning = "pending requests could push you over 100% if approved"
	}

	facts := map[string]any{
		"today":            today,
		"current_work":     current,
		"upcoming_work":    upcoming,
		"this_week_load":   map[string]any{"approved_percent": thisWeek.MaxApprovedCapacity, "risk_percent": thisWeek.MaxRiskCapacity},
		"next_week_load":   map[string]any{"approved_percent": nextWeek.MaxApprovedCapacity, "risk_percent": nextWeek.MaxRiskCapacity},
		"overbook_warning": overbookWarning,
	}

	citations := []llmCitation{
		{ID: "C1", Label: "Current work", Value: fmt.Sprintf("%d active assignment(s) today (%s)", len(current), today)},
		{ID: "C2", Label: "Upcoming work", Value: fmt.Sprintf("%d upcoming approved assignment(s)", len(upcoming))},
		{ID: "C3", Label: "This week load", Value: fmt.Sprintf("%d%% approved, %d%% with pending", thisWeek.MaxApprovedCapacity, thisWeek.MaxRiskCapacity)},
		{ID: "C4", Label: "Next week load", Value: fmt.Sprintf("%d%% approved, %d%% with pending", nextWeek.MaxApprovedCapacity, nextWeek.MaxRiskCapacity)},
	}
	if overbookWarning != "" {
		citations = append(citations, llmCitation{ID: "C5", Label: "Overbook warning", Value: overbookWarning})
	}

	suggested := make([]llmSuggestedAction, 0, 3)
	if len(current) > 0 {
		suggested = append(suggested, llmSuggestedAction{ID: "view_current", Label: "View current task"})
	}
	if len(upcoming) > 0 {
		suggested = append(suggested, llmSuggestedAction{ID: "prepare_upcoming", Label: "Prepare for upcoming project"})
		suggested = append(suggested, llmSuggestedAction{ID: "contact_requester", Label: "Contact the PM/PO"})
	}
	if overbookWarning != "" {
		suggested = append(suggested, llmSuggestedAction{ID: "check_overbook", Label: "Check your overbooked days"})
	}

	serveLLMSummary(w, llmSummarySpec{
		Scope:     "my-schedule",
		CacheKey:  ba.ID,
		Facts:     facts,
		Citations: citations,
		Context:   "a BA's personal schedule. The reader is the BA planning their own week",
		Guidance: `- Speak directly to the BA ("you"). Cover: what you are on now (project, capacity, days remaining), what starts next (project, start date, requester), and your week load.
- If upcoming work exists, remind the BA to prepare and name the PM/PO requester from facts.
- If overbook_warning is non-empty, state it clearly; if it is empty, say the load has no overbook signal.
- MaxBullets 4.`,
		MaxBullets:       4,
		SuggestedActions: suggested,
		Fallback: func() *llmSummary {
			return buildMyScheduleFallback(current, upcoming, thisWeek, nextWeek, overbookWarning, citations)
		},
	})
}

type myScheduleAssignmentFact struct {
	Title           string `json:"title"`
	Project         string `json:"project"`
	Requester       string `json:"requester"`
	StartDate       string `json:"start_date"`
	EndDate         string `json:"end_date"`
	CapacityPercent int    `json:"capacity_percent"`
	DaysRemaining   int    `json:"days_remaining,omitempty"`
	StartsInDays    int    `json:"starts_in_days,omitempty"`
}

func weekBounds(value time.Time) (time.Time, time.Time) {
	day := normalizeDate(value)
	offset := (int(day.Weekday()) + 6) % 7 // Monday = 0
	start := day.AddDate(0, 0, -offset)
	return start, start.AddDate(0, 0, 6)
}

func buildMyScheduleFallback(
	current, upcoming []myScheduleAssignmentFact,
	thisWeek, nextWeek RangeCapacity,
	overbookWarning string,
	citations []llmCitation,
) *llmSummary {
	bullets := make([]llmSummaryBullet, 0, 4)
	if len(current) > 0 {
		first := current[0]
		bullets = append(bullets, llmSummaryBullet{Text: fmt.Sprintf("You are on %s at %d%% capacity with %d day(s) remaining.", first.Project, first.CapacityPercent, first.DaysRemaining), Citations: []string{"C1"}})
	} else {
		bullets = append(bullets, llmSummaryBullet{Text: "You have no active assignment today.", Citations: []string{"C1"}})
	}
	if len(upcoming) > 0 {
		first := upcoming[0]
		bullets = append(bullets, llmSummaryBullet{Text: fmt.Sprintf("Next up: %s at %d%% capacity, starting %s (requested by %s).", first.Project, first.CapacityPercent, first.StartDate, first.Requester), Citations: []string{"C2"}})
	}
	bullets = append(bullets, llmSummaryBullet{Text: fmt.Sprintf("Week load: %d%% this week, %d%% next week (approved).", thisWeek.MaxApprovedCapacity, nextWeek.MaxApprovedCapacity), Citations: []string{"C3", "C4"}})
	if overbookWarning != "" {
		bullets = append(bullets, llmSummaryBullet{Text: "Warning: " + overbookWarning + ".", Citations: []string{"C5"}})
	}
	summary := fmt.Sprintf("You have %d active and %d upcoming assignment(s); this week's approved load peaks at %d%%.", len(current), len(upcoming), thisWeek.MaxApprovedCapacity)
	return &llmSummary{Summary: summary, Bullets: bullets, Citations: citations}
}
