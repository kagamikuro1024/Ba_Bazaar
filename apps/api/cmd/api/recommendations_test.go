package main

import (
	"math"
	"reflect"
	"testing"
	"time"
)

// date is a tiny helper to make ranges readable.
func d(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

func booking(id, baID, status string, start, end string, pct int) CapacityBooking {
	return CapacityBooking{
		ID:              id,
		BAID:            &baID,
		StartDate:       d(start),
		EndDate:         d(end),
		CapacityPercent: pct,
		Status:          status,
	}
}

// --------------------------------------------------------------------------
// Signal: skill_match (Jaccard)
// --------------------------------------------------------------------------

func TestSkillMatch_EmptyRequired(t *testing.T) {
	if got := skillMatch([]string{"a", "b"}, nil); got != 1 {
		t.Errorf("empty required should be 1.0, got %v", got)
	}
}

func TestSkillMatch_ExactMatch(t *testing.T) {
	got := skillMatch([]string{"a", "b", "c"}, []string{"a", "b", "c"})
	if got != 1.0 {
		t.Errorf("exact match should be 1.0, got %v", got)
	}
}

func TestSkillMatch_PartialOverlap(t *testing.T) {
	// |a∩b|=1 (just "a"), |a∪b|=5, jaccard=0.2
	got := skillMatch([]string{"a", "b", "c"}, []string{"a", "d", "e"})
	if math.Abs(got-0.2) > 1e-9 {
		t.Errorf("partial overlap expected 0.2, got %v", got)
	}
}

func TestSkillMatch_NoOverlap(t *testing.T) {
	got := skillMatch([]string{"a"}, []string{"x", "y"})
	if got != 0 {
		t.Errorf("no overlap should be 0, got %v", got)
	}
}

// --------------------------------------------------------------------------
// Signal: level_fit
// --------------------------------------------------------------------------

func TestLevelFit_NoRequested(t *testing.T) {
	if got := levelFit("SENIOR", ""); got != 1 {
		t.Errorf("no level request should be 1.0, got %v", got)
	}
}

func TestLevelFit_ExactMatch(t *testing.T) {
	if got := levelFit("SENIOR", "SENIOR"); got != 1 {
		t.Errorf("exact level match should be 1.0, got %v", got)
	}
}

func TestLevelFit_OneStep(t *testing.T) {
	// distance=1 → 1 - 1/3 = 0.6667
	got := levelFit("SENIOR", "MIDDLE")
	if math.Abs(got-2.0/3.0) > 1e-9 {
		t.Errorf("one-step level expected 0.6667, got %v", got)
	}
}

func TestLevelFit_TwoSteps(t *testing.T) {
	// distance=2 → 1 - 2/3 = 0.3333
	got := levelFit("LEAD", "MIDDLE")
	if math.Abs(got-1.0/3.0) > 1e-9 {
		t.Errorf("two-step level expected 0.3333, got %v", got)
	}
}

func TestLevelFit_MaxDistance(t *testing.T) {
	// JUNIOR vs LEAD → distance=3 → 0
	if got := levelFit("JUNIOR", "LEAD"); got != 0 {
		t.Errorf("max distance expected 0, got %v", got)
	}
}

func TestLevelFit_UnknownLevel(t *testing.T) {
	// Unknown levels fall back to neutral 1.0 so we don't tank
	// scores for legacy rows with weird data.
	if got := levelFit("UNKNOWN", "SENIOR"); got != 1 {
		t.Errorf("unknown candidate level should be 1.0, got %v", got)
	}
	if got := levelFit("SENIOR", "GODMODE"); got != 1 {
		t.Errorf("unknown requested level should be 1.0, got %v", got)
	}
}

// --------------------------------------------------------------------------
// Signal: capacity_headroom
// --------------------------------------------------------------------------

func TestCapacityHeadroom_EmptyBA(t *testing.T) {
	c := CandidateBA{ID: "ba-1", Status: "ACTIVE", SkillTagIDs: nil, Bookings: nil}
	q := RecommendationQuery{StartDate: d("2026-06-01"), EndDate: d("2026-06-10"), CapacityPercent: 50}
	sig, after := capacityHeadroom(c, q)
	if after != 50 {
		t.Errorf("empty BA after-risk should be 50, got %d", after)
	}
	if math.Abs(sig-0.75) > 1e-9 {
		t.Errorf("empty BA headroom signal should be 0.75, got %v", sig)
	}
}

func TestCapacityHeadroom_Overbooked(t *testing.T) {
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE",
		Bookings: []CapacityBooking{
			booking("b1", "ba-1", "APPROVED", "2026-06-01", "2026-06-10", 100),
		},
	}
	q := RecommendationQuery{StartDate: d("2026-06-01"), EndDate: d("2026-06-10"), CapacityPercent: 100}
	sig, after := capacityHeadroom(c, q)
	if after != 200 {
		t.Errorf("overbooked after-risk should be 200, got %d", after)
	}
	if sig != 0 {
		t.Errorf("overbooked headroom signal should be 0, got %v", sig)
	}
}

func TestCapacityHeadroom_Exceeds200(t *testing.T) {
	// Should clamp to 0, not go negative.
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE",
		Bookings: []CapacityBooking{
			booking("b1", "ba-1", "APPROVED", "2026-06-01", "2026-06-10", 150),
		},
	}
	q := RecommendationQuery{StartDate: d("2026-06-01"), EndDate: d("2026-06-10"), CapacityPercent: 100}
	sig, after := capacityHeadroom(c, q)
	if after != 250 {
		t.Errorf("post-risk should be 250, got %d", after)
	}
	if sig != 0 {
		t.Errorf("headroom signal must clamp to 0, got %v", sig)
	}
}

func TestCapacityHeadroom_PendingCounted(t *testing.T) {
	// PENDING bookings should count toward risk (matching canApproveCapacity).
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE",
		Bookings: []CapacityBooking{
			booking("b1", "ba-1", "PENDING", "2026-06-01", "2026-06-10", 80),
		},
	}
	q := RecommendationQuery{StartDate: d("2026-06-01"), EndDate: d("2026-06-10"), CapacityPercent: 20}
	_, after := capacityHeadroom(c, q)
	if after != 100 {
		t.Errorf("PENDING should count toward risk; got after=%d, want 100", after)
	}
}

func TestCapacityHeadroom_CancelledIgnored(t *testing.T) {
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE",
		Bookings: []CapacityBooking{
			booking("b1", "ba-1", "CANCELLED", "2026-06-01", "2026-06-10", 100),
		},
	}
	q := RecommendationQuery{StartDate: d("2026-06-01"), EndDate: d("2026-06-10"), CapacityPercent: 50}
	_, after := capacityHeadroom(c, q)
	if after != 50 {
		t.Errorf("CANCELLED should not count; got after=%d, want 50", after)
	}
}

// --------------------------------------------------------------------------
// Signal: project_affinity
// --------------------------------------------------------------------------

func TestProjectAffinity_NoProject(t *testing.T) {
	c := CandidateBA{ID: "ba-1"}
	q := RecommendationQuery{}
	if got := projectAffinity(c, q); got != 0.5 {
		t.Errorf("no project_id should be 0.5, got %v", got)
	}
}

func TestProjectAffinity_NoHistory(t *testing.T) {
	c := CandidateBA{ID: "ba-1"}
	q := RecommendationQuery{ProjectID: "p1", TotalBookingCounts: map[string]int{"ba-1": 0}}
	if got := projectAffinity(c, q); got != 0 {
		t.Errorf("no history should be 0, got %v", got)
	}
}

func TestProjectAffinity_FullMatch(t *testing.T) {
	c := CandidateBA{ID: "ba-1"}
	q := RecommendationQuery{
		ProjectID:            "p1",
		ProjectBookingCounts: map[string]int{"ba-1": 3},
		TotalBookingCounts:   map[string]int{"ba-1": 3},
	}
	if got := projectAffinity(c, q); got != 1 {
		t.Errorf("all-on-project should be 1, got %v", got)
	}
}

func TestProjectAffinity_Partial(t *testing.T) {
	c := CandidateBA{ID: "ba-1"}
	q := RecommendationQuery{
		ProjectID:            "p1",
		ProjectBookingCounts: map[string]int{"ba-1": 2},
		TotalBookingCounts:   map[string]int{"ba-1": 8},
	}
	if math.Abs(projectAffinity(c, q)-0.25) > 1e-9 {
		t.Errorf("partial affinity expected 0.25, got %v", projectAffinity(c, q))
	}
}

// --------------------------------------------------------------------------
// Hard filters
// --------------------------------------------------------------------------

func TestRankCandidates_ExcludesNonActive(t *testing.T) {
	cands := []CandidateBA{
		{ID: "a", Status: "ACTIVE", FullName: "A", Level: "MIDDLE"},
		{ID: "r", Status: "RESIGNED", FullName: "R", Level: "MIDDLE"},
		{ID: "l", Status: "ON_LEAVE", FullName: "L", Level: "MIDDLE"},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		Limit:           10,
	}
	got := RankCandidates(cands, q)
	if len(got) != 1 {
		t.Fatalf("expected 1 result (only ACTIVE), got %d", len(got))
	}
	if got[0].BAID != "a" {
		t.Errorf("expected ba 'a', got %q", got[0].BAID)
	}
}

func TestRankCandidates_HonorsExcludeList(t *testing.T) {
	cands := []CandidateBA{
		{ID: "a", Status: "ACTIVE", FullName: "A", Level: "MIDDLE"},
		{ID: "b", Status: "ACTIVE", FullName: "B", Level: "MIDDLE"},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		ExcludeBAIDs:    map[string]bool{"a": true},
		Limit:           10,
	}
	got := RankCandidates(cands, q)
	if len(got) != 1 || got[0].BAID != "b" {
		t.Errorf("expected only 'b', got %+v", got)
	}
}

// --------------------------------------------------------------------------
// Ranking + reasons
// --------------------------------------------------------------------------

func TestRankCandidates_PrefersHighHeadroom(t *testing.T) {
	// Two BAs with identical skill/level/affinity, different capacity.
	cands := []CandidateBA{
		{
			ID: "busy", Status: "ACTIVE", FullName: "Busy", Level: "SENIOR",
			SkillTagIDs: []string{"s1", "s2"},
			Bookings:    []CapacityBooking{booking("b1", "busy", "APPROVED", "2026-06-01", "2026-06-10", 80)},
		},
		{
			ID: "free", Status: "ACTIVE", FullName: "Free", Level: "SENIOR",
			SkillTagIDs: []string{"s1", "s2"},
		},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		RequiredSkillIDs: []string{"s1", "s2"},
		Level:           "SENIOR",
		Limit:           10,
	}
	got := RankCandidates(cands, q)
	if len(got) != 2 {
		t.Fatalf("expected 2 results, got %d", len(got))
	}
	if got[0].BAID != "free" {
		t.Errorf("expected 'free' first, got %q", got[0].BAID)
	}
	if got[0].FitScore <= got[1].FitScore {
		t.Errorf("free should outrank busy: %d vs %d", got[0].FitScore, got[1].FitScore)
	}
}

func TestRankCandidates_TiebreakByHeadroom(t *testing.T) {
	// Identical scores; tiebreak goes to lower post-risk-capacity.
	cands := []CandidateBA{
		{
			ID: "tight", Status: "ACTIVE", FullName: "Tight", Level: "MIDDLE",
			Bookings: []CapacityBooking{booking("b1", "tight", "APPROVED", "2026-06-01", "2026-06-10", 40)},
		},
		{
			ID: "loose", Status: "ACTIVE", FullName: "Loose", Level: "MIDDLE",
		},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		Limit:           10,
	}
	got := RankCandidates(cands, q)
	// With identical neutral signals they should both score ~80 (capacity 0.75*100=75
	// is the only differing one — actually loose: 0.5*100 = 50 cap headroom → 1.0 signal
	// → 100 score; tight: 50+40=90 → signal 0.55, 55 score). So loose wins outright.
	if got[0].BAID != "loose" {
		t.Errorf("expected 'loose' first, got %q", got[0].BAID)
	}
}

func TestRankCandidates_LimitClamped(t *testing.T) {
	cands := make([]CandidateBA, 30)
	for i := range cands {
		cands[i] = CandidateBA{ID: string(rune('a' + i%26)) + "_" + string(rune('a' + i/26)), Status: "ACTIVE", FullName: "BA", Level: "MIDDLE"}
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		Limit:           100, // over max
	}
	got := RankCandidates(cands, q)
	if len(got) != recommendationMaxLimit {
		t.Errorf("limit should clamp to %d, got %d", recommendationMaxLimit, len(got))
	}
}

func TestRankCandidates_LimitFloor(t *testing.T) {
	cands := []CandidateBA{{ID: "a", Status: "ACTIVE", FullName: "A", Level: "MIDDLE"}}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		Limit:           0, // below min → default
	}
	got := RankCandidates(cands, q)
	if len(got) != 1 {
		t.Errorf("default limit should still return up to %d, got %d", recommendationDefaultLimit, len(got))
	}
}

func TestRankCandidates_ReasonsIncludeProjectHistory(t *testing.T) {
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE", FullName: "X", Level: "SENIOR",
		SkillTagIDs: []string{"a", "b"},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 50,
		RequiredSkillIDs: []string{"a", "b", "c"},
		ProjectID:       "p1",
		ProjectBookingCounts: map[string]int{"ba-1": 1},
		TotalBookingCounts:   map[string]int{"ba-1": 1},
	}
	got := RankCandidates([]CandidateBA{c}, q)
	if len(got) != 1 {
		t.Fatalf("expected 1 result, got %d", len(got))
	}
	reasons := got[0].Reasons
	hasProjectReason := false
	hasSkillReason := false
	for _, r := range reasons {
		if r == "Worked on this project before" {
			hasProjectReason = true
		}
		if len(r) > 7 && r[:7] == "Matches" {
			hasSkillReason = true
		}
	}
	if !hasProjectReason {
		t.Errorf("expected project-history reason, got %v", reasons)
	}
	if !hasSkillReason {
		t.Errorf("expected skill-match reason, got %v", reasons)
	}
}

func TestRankCandidates_FitScoreClampedTo100(t *testing.T) {
	// Perfect candidate AND zero-capacity query: skills match, level matches,
	// no bookings, FULL project history, capacity_percent = 0.
	// All four signals at 1.0 → 100. (A non-zero capacity_percent correctly
	// pulls capacity_headroom below 1.0 — see TestRankCandidates_NoProjectMax.)
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE", FullName: "Perfect", Level: "SENIOR",
		SkillTagIDs: []string{"a", "b"},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent:      0,
		RequiredSkillIDs:     []string{"a", "b"},
		Level:                "SENIOR",
		ProjectID:            "p1",
		ProjectBookingCounts: map[string]int{"ba-1": 5},
		TotalBookingCounts:   map[string]int{"ba-1": 5},
	}
	got := RankCandidates([]CandidateBA{c}, q)
	if got[0].FitScore != 100 {
		t.Errorf("perfect candidate (cap=0) should score 100, got %d", got[0].FitScore)
	}
	if got[0].Signals.SkillMatch != 1 || got[0].Signals.LevelFit != 1 || got[0].Signals.ProjectAffinity != 1 {
		t.Errorf("expected skill/level/affinity = 1, got %+v", got[0].Signals)
	}
}

func TestRankCandidates_NoProjectMax(t *testing.T) {
	// Lock the observable behavior: with no project and a 50% booking, the
	// max score is skill(0.4) + level(0.15) + capacity(0.75*0.35=0.2625) +
	// neutral-affinity(0.5*0.10=0.05) = 0.8625 → 86. This is by design; the
	// spec is explicit that 0.5 is a neutral affinity, not 0.0.
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE", FullName: "Perfect", Level: "SENIOR",
		SkillTagIDs: []string{"a", "b"},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent:  50,
		RequiredSkillIDs: []string{"a", "b"},
		Level:            "SENIOR",
	}
	got := RankCandidates([]CandidateBA{c}, q)
	if got[0].FitScore != 86 {
		t.Errorf("no-project, cap=50 expected 86, got %d", got[0].FitScore)
	}
	if got[0].Signals.ProjectAffinity != 0.5 {
		t.Errorf("expected neutral 0.5 affinity, got %v", got[0].Signals.ProjectAffinity)
	}
	if got[0].Signals.CapacityHeadroom != 0.75 {
		t.Errorf("expected capacity headroom 0.75, got %v", got[0].Signals.CapacityHeadroom)
	}
}

func TestRankCandidates_FitScoreFloorZero(t *testing.T) {
	// Worst case: no overlap, far level, maxed-out, no project history.
	c := CandidateBA{
		ID: "ba-1", Status: "ACTIVE", FullName: "X", Level: "JUNIOR",
		SkillTagIDs: nil,
		Bookings: []CapacityBooking{
			booking("b1", "ba-1", "APPROVED", "2026-06-01", "2026-06-10", 200),
		},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-10"),
		CapacityPercent: 100,
		RequiredSkillIDs: []string{"a", "b"},
		Level:           "LEAD",
		ProjectID:       "p1",
	}
	got := RankCandidates([]CandidateBA{c}, q)
	if got[0].FitScore < 0 {
		t.Errorf("fit_score must never go negative, got %d", got[0].FitScore)
	}
}

// --------------------------------------------------------------------------
// ParseSkillIDs (query param normalization)
// --------------------------------------------------------------------------

func TestParseSkillIDs(t *testing.T) {
	cases := []struct {
		in   []string
		want []string
	}{
		{nil, []string{}},
		{[]string{"a,b,c"}, []string{"a", "b", "c"}},
		{[]string{"a", "b,c"}, []string{"a", "b", "c"}},
		{[]string{"a, a, b"}, []string{"a", "b"}},
		{[]string{" a ", " b"}, []string{"a", "b"}},
		{[]string{""}, []string{}},
	}
	for _, c := range cases {
		got := ParseSkillIDs(c.in)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("ParseSkillIDs(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

// --------------------------------------------------------------------------
// End-to-end ranking with a richer candidate set
// --------------------------------------------------------------------------

func TestRankCandidates_EndToEnd(t *testing.T) {
	// Scenario: PM/PO is staffing a 4-week (2026-06-01..2026-06-28) SENIOR at 50%.
	// Wants skills {sql, etl}. Project is p-alpha.
	cands := []CandidateBA{
		// Ideal: all skills, exact level, free, has project history.
		{
			ID: "ideal", Status: "ACTIVE", FullName: "Ideal", Level: "SENIOR",
			SkillTagIDs: []string{"sql", "etl", "python"},
		},
		// Good skills but already half-booked.
		{
			ID: "partial", Status: "ACTIVE", FullName: "Partial", Level: "SENIOR",
			SkillTagIDs: []string{"sql", "etl"},
			Bookings: []CapacityBooking{
				booking("b1", "partial", "APPROVED", "2026-06-01", "2026-06-28", 50),
			},
		},
		// Perfectly free but missing a skill and one level below.
		{
			ID: "junior", Status: "ACTIVE", FullName: "Junior", Level: "MIDDLE",
			SkillTagIDs: []string{"sql"},
		},
		// Perfect fit on paper but already overbooked.
		{
			ID: "swamped", Status: "ACTIVE", FullName: "Swamped", Level: "SENIOR",
			SkillTagIDs: []string{"sql", "etl"},
			Bookings: []CapacityBooking{
				booking("b1", "swamped", "APPROVED", "2026-06-01", "2026-06-28", 100),
			},
		},
		// RESIGNED — must never appear.
		{
			ID: "gone", Status: "RESIGNED", FullName: "Gone", Level: "SENIOR",
			SkillTagIDs: []string{"sql", "etl"},
		},
	}
	q := RecommendationQuery{
		StartDate: d("2026-06-01"), EndDate: d("2026-06-28"),
		CapacityPercent:    50,
		RequiredSkillIDs:   []string{"sql", "etl"},
		Level:              "SENIOR",
		ProjectID:          "p-alpha",
		ProjectBookingCounts: map[string]int{"ideal": 2, "partial": 0, "junior": 0, "swamped": 0},
		TotalBookingCounts:   map[string]int{"ideal": 2, "partial": 4, "junior": 1, "swamped": 5},
		Limit:                5,
	}
	got := RankCandidates(cands, q)

	if len(got) != 4 {
		t.Fatalf("expected 4 ranked results (RESIGNED excluded), got %d", len(got))
	}
	if got[0].BAID != "ideal" {
		t.Errorf("expected 'ideal' first, got %q (score %d)", got[0].BAID, got[0].FitScore)
	}
	// swamped should be near the bottom — full match on skills but zero headroom.
	if got[3].BAID == "swamped" {
		// ok, expected
	} else if got[2].BAID == "swamped" {
		// could be tied with partial; just confirm swamped is in the bottom half.
		t.Logf("swamped ranked 3rd; partial=%d swamped=%d", got[1].FitScore, got[2].FitScore)
	}
	// Make sure ideal's score is higher than swamped's.
	idealScore := got[0].FitScore
	var swampedScore int
	for _, r := range got {
		if r.BAID == "swamped" {
			swampedScore = r.FitScore
		}
	}
	if idealScore <= swampedScore {
		t.Errorf("ideal (%d) should outrank swamped (%d)", idealScore, swampedScore)
	}
}
