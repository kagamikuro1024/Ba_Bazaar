package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

// ============================================================================
// GET /api/bookings/action-center/llm-summary
//
// Grounded AI summary of the BA Manager request queue. Answers: how should
// the manager read the queue, which request goes first, and what to do with
// open (unassigned) requests. Approved/completed work is intentionally left
// out of focus. Cached by data fingerprint.
// ============================================================================

type actionCenterRequestFact struct {
	Title           string `json:"title"`
	Project         string `json:"project"`
	Priority        string `json:"priority"`
	Requester       string `json:"requester"`
	Unassigned      bool   `json:"unassigned"`
	CapacityRisk    bool   `json:"capacity_risk"`
	BAName          string `json:"ba_name,omitempty"`
	StartDate       string `json:"start_date"`
	EndDate         string `json:"end_date"`
	CapacityPercent int    `json:"capacity_percent"`
}

func (app *App) handleActionCenterLLMSummary(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canApproveBooking(user.Role) && user.Role != "ADMIN" {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required."})
		return
	}
	_ = app.syncBookingStatuses(r.Context())

	facts, citations, suggested, err := app.actionCenterFacts(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}

	serveLLMSummary(w, llmSummarySpec{
		Scope:     "action-center",
		CacheKey:  "queue",
		Facts:     facts,
		Citations: citations,
		Context:   "the BA Manager Action Center (request queue). The reader is a BA Manager deciding which request to process first",
		Guidance: `- Order: urgent requests first, then capacity risks, then unassigned (open) requests, then the rest of the pending queue.
- Name the specific request to handle first if top_requests provides one, and say why (priority/capacity risk/unassigned).
- For unassigned requests suggest assigning a BA (the product has an AI Suggest BA feature the manager can use).
- Mention approved/completed counts at most briefly at the end, if at all.`,
		SuggestedActions: suggested,
		Fallback: func() *llmSummary {
			return buildActionCenterFallback(facts, citations)
		},
	})
}

func (app *App) actionCenterFacts(ctx context.Context) (map[string]any, []llmCitation, []llmSuggestedAction, error) {
	// Queue counts in one query.
	var total, pending, approvedLike, completed int
	err := app.DB.Pool.QueryRow(ctx, `
		select count(*),
		       count(*) filter (where status = 'PENDING'),
		       count(*) filter (where status in ('APPROVED','IN_PROGRESS')),
		       count(*) filter (where status = 'COMPLETED')
		from bookings`).Scan(&total, &pending, &approvedLike, &completed)
	if err != nil {
		return nil, nil, nil, err
	}

	// Pending queue with details (small in practice; the queue a manager
	// can act on). Risk is computed per assigned pending booking.
	pendingBookings, err := app.queryBookings(ctx, `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where status = 'PENDING' order by created_at asc limit 50`)
	if err != nil {
		return nil, nil, nil, err
	}

	urgent, high, unassigned, capacityRisk := 0, 0, 0, 0
	requestFacts := make([]actionCenterRequestFact, 0, len(pendingBookings))
	for _, booking := range pendingBookings {
		fact := actionCenterRequestFact{
			Title:           booking.Title,
			Priority:        booking.Priority,
			Unassigned:      booking.BAID == nil,
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
		switch booking.Priority {
		case "URGENT":
			urgent++
		case "HIGH":
			high++
		}
		if booking.BAID == nil {
			unassigned++
		} else {
			if booking.BA != nil {
				fact.BAName = booking.BA.FullName
			}
			if ok, _, _ := app.approvalCheck(ctx, *booking.BAID, booking.StartDate, booking.EndDate, booking.CapacityPercent, booking.ID); !ok {
				fact.CapacityRisk = true
				capacityRisk++
			}
		}
		requestFacts = append(requestFacts, fact)
	}

	// Rank what to handle first: urgent > capacity risk > high > unassigned.
	sort.SliceStable(requestFacts, func(i, j int) bool {
		return actionCenterRank(requestFacts[i]) > actionCenterRank(requestFacts[j])
	})
	top := requestFacts
	if len(top) > 5 {
		top = top[:5]
	}

	facts := map[string]any{
		"queue": map[string]any{
			"total_requests":     total,
			"pending":            pending,
			"urgent_pending":     urgent,
			"high_pending":       high,
			"unassigned_pending": unassigned,
			"capacity_risk":      capacityRisk,
			"approved_or_active": approvedLike,
			"completed":          completed,
		},
		"top_requests": top,
	}

	citations := []llmCitation{
		{ID: "C1", Label: "Queue size", Value: fmt.Sprintf("%d total requests, %d pending", total, pending)},
		{ID: "C2", Label: "Priorities", Value: fmt.Sprintf("%d urgent, %d high among pending", urgent, high)},
		{ID: "C3", Label: "Unassigned", Value: fmt.Sprintf("%d pending requests without a BA", unassigned)},
		{ID: "C4", Label: "Capacity risk", Value: fmt.Sprintf("%d pending requests would exceed the assigned BA's capacity", capacityRisk)},
		{ID: "C5", Label: "Closed work", Value: fmt.Sprintf("%d approved/in progress, %d completed", approvedLike, completed)},
	}
	if len(top) > 0 {
		citations = append(citations, llmCitation{ID: "C6", Label: "Top request", Value: fmt.Sprintf("%s (%s%s%s)", top[0].Title, top[0].Priority, ternary(top[0].CapacityRisk, ", capacity risk", ""), ternary(top[0].Unassigned, ", unassigned", ""))})
	}

	suggested := make([]llmSuggestedAction, 0, 4)
	if urgent > 0 {
		suggested = append(suggested, llmSuggestedAction{ID: "review_urgent", Label: "Review urgent requests"})
	}
	if unassigned > 0 {
		suggested = append(suggested, llmSuggestedAction{ID: "assign_open", Label: "Assign BA to open requests"})
	}
	if capacityRisk > 0 {
		suggested = append(suggested, llmSuggestedAction{ID: "review_capacity_risk", Label: "Review capacity-risk requests"})
	}
	if pending > 0 && len(suggested) == 0 {
		suggested = append(suggested, llmSuggestedAction{ID: "review_pending", Label: "Review pending requests"})
	}

	return facts, citations, suggested, nil
}

func actionCenterRank(fact actionCenterRequestFact) int {
	score := 0
	switch fact.Priority {
	case "URGENT":
		score += 400
	case "HIGH":
		score += 300
	case "MEDIUM":
		score += 200
	default:
		score += 100
	}
	if fact.CapacityRisk {
		score += 50
	}
	if fact.Unassigned {
		score += 25
	}
	return score
}

func buildActionCenterFallback(facts map[string]any, citations []llmCitation) *llmSummary {
	queue := mapValue(facts, "queue")
	bullets := []llmSummaryBullet{
		{Text: fmt.Sprintf("The queue holds %v requests, %v of them pending review.", queue["total_requests"], queue["pending"]), Citations: []string{"C1"}},
		{Text: fmt.Sprintf("Among pending: %v urgent and %v high priority.", queue["urgent_pending"], queue["high_pending"]), Citations: []string{"C2"}},
		{Text: fmt.Sprintf("%v pending requests still need a BA assigned.", queue["unassigned_pending"]), Citations: []string{"C3"}},
		{Text: fmt.Sprintf("%v pending requests carry a capacity risk for the assigned BA.", queue["capacity_risk"]), Citations: []string{"C4"}},
	}
	summaryText := fmt.Sprintf("%v pending requests: %v urgent, %v unassigned, %v with capacity risk.", queue["pending"], queue["urgent_pending"], queue["unassigned_pending"], queue["capacity_risk"])
	if top, ok := facts["top_requests"].([]actionCenterRequestFact); ok && len(top) > 0 {
		for _, citation := range citations {
			if citation.ID == "C6" {
				bullets = append([]llmSummaryBullet{{Text: fmt.Sprintf("Handle %q first (%s priority%s%s).", top[0].Title, strings.ToLower(top[0].Priority), ternary(top[0].CapacityRisk, ", capacity risk", ""), ternary(top[0].Unassigned, ", unassigned", "")), Citations: []string{"C6"}}}, bullets...)
				break
			}
		}
	}
	if len(bullets) > 5 {
		bullets = bullets[:5]
	}
	return &llmSummary{Summary: summaryText, Bullets: bullets, Citations: citations}
}
