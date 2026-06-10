package main

import (
	"math"
	"sort"
	"strings"
	"time"
)

// ============================================================================
// BA recommendation engine — pure scoring, no IO.
//
// Mirrors docs/plans/recommendation-model.md and the NestJS reference at
// apps/api/src/recommendations/recommendations.service.ts. The HTTP handler
// (recommendations_handler.go) is responsible for loading candidates and
// projecting them into CandidateBA; everything in this file is deterministic
// and trivially unit-testable (recommendations_test.go).
// ============================================================================

// Default weights from the spec. Sum to 1.0.
type RecommendationWeights struct {
	Skill    float64
	Level    float64
	Capacity float64
	Affinity float64
}

var DefaultWeights = RecommendationWeights{
	Skill:    0.40,
	Level:    0.15,
	Capacity: 0.35,
	Affinity: 0.10,
}

const (
	recommendationDefaultLimit = 5
	recommendationMaxLimit     = 25
)

// Level rank for level-fit distance (0..3).
var levelRank = map[string]int{
	"JUNIOR": 0,
	"MIDDLE": 1,
	"SENIOR": 2,
	"LEAD":   3,
}

// CandidateBA is the minimal projection the scorer needs. Built by the
// handler from ba_profiles + ba_skill_tags + bookings.
type CandidateBA struct {
	ID         string
	FullName   string
	Level      string
	Status     string
	SkillTagIDs []string
	// Bookings overlapping or near the query range. We fetch a wide
	// window from the DB so the capacity engine sees all overlaps.
	Bookings []CapacityBooking
}

// RecommendationQuery is the input the handler builds from the request.
type RecommendationQuery struct {
	StartDate          time.Time
	EndDate            time.Time
	CapacityPercent    int
	RequiredSkillIDs   []string
	Level              string
	ProjectID          string
	// ProjectBookingCounts[baID] = # non-cancelled bookings for (ba, project).
	ProjectBookingCounts map[string]int
	// TotalBookingCounts[baID] = # non-cancelled bookings ever (for affinity ratio).
	TotalBookingCounts map[string]int
	ExcludeBAIDs       map[string]bool
	Limit              int
	Weights            *RecommendationWeights
}

// Signals is the 0..1 breakdown of why this BA scored the way they did.
type Signals struct {
	SkillMatch       float64 `json:"skill_match"`
	LevelFit         float64 `json:"level_fit"`
	CapacityHeadroom float64 `json:"capacity_headroom"`
	ProjectAffinity  float64 `json:"project_affinity"`
}

// RecommendationResult is the per-BA output the API returns.
type RecommendationResult struct {
	BAID                 string   `json:"ba_id"`
	FullName             string   `json:"full_name"`
	Level                string   `json:"level"`
	Status               string   `json:"status"`
	FitScore             int      `json:"fit_score"`
	Signals              Signals  `json:"signals"`
	MaxRiskCapacityAfter int      `json:"max_risk_capacity_after"`
	Reasons              []string `json:"reasons"`
}

// jaccard returns |a ∩ b| / |a ∪ b| over two string slices.
func jaccard(a, b []string) float64 {
	if len(a) == 0 && len(b) == 0 {
		return 1
	}
	aSet := make(map[string]struct{}, len(a))
	for _, v := range a {
		aSet[v] = struct{}{}
	}
	bSet := make(map[string]struct{}, len(b))
	for _, v := range b {
		bSet[v] = struct{}{}
	}
	intersection := 0
	for v := range aSet {
		if _, ok := bSet[v]; ok {
			intersection++
		}
	}
	union := len(aSet) + len(bSet) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func skillMatch(candidateTags, required []string) float64 {
	if len(required) == 0 {
		return 1
	}
	return jaccard(candidateTags, required)
}

func levelFit(candidateLevel, requested string) float64 {
	if requested == "" {
		return 1
	}
	cr, ok1 := levelRank[candidateLevel]
	rr, ok2 := levelRank[requested]
	if !ok1 || !ok2 {
		return 1
	}
	dist := cr - rr
	if dist < 0 {
		dist = -dist
	}
	if dist > 3 {
		dist = 3
	}
	return 1 - float64(dist)/3.0
}

func capacityHeadroom(candidate CandidateBA, q RecommendationQuery) (signal float64, maxRiskAfter int) {
	cap := getRangeCapacity(candidate.Bookings, q.StartDate, q.EndDate, "")
	maxRiskAfter = cap.MaxRiskCapacity + q.CapacityPercent
	if maxRiskAfter < 0 {
		maxRiskAfter = 0
	}
	// 0% headroom when post-add risk >= 200%, full headroom at 0%.
	ratio := float64(maxRiskAfter) / 200.0
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	return 1 - ratio, maxRiskAfter
}

func projectAffinity(candidate CandidateBA, q RecommendationQuery) float64 {
	if q.ProjectID == "" {
		return 0.5
	}
	projectCount := q.ProjectBookingCounts[candidate.ID]
	totalCount := q.TotalBookingCounts[candidate.ID]
	if totalCount == 0 {
		return 0
	}
	ratio := float64(projectCount) / float64(totalCount)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	return ratio
}

func buildReasons(
	signals Signals,
	skillMatched, skillRequested int,
	maxRiskAfter int,
	hasProject bool,
	projectID string,
	levelFitScore float64,
) []string {
	reasons := make([]string, 0, 3)
	if skillRequested > 0 {
		switch {
		case skillMatched == skillRequested:
			reasons = append(reasons, "Matches all "+itoa(skillRequested)+" requested skills")
		case skillMatched > 0:
			reasons = append(reasons, "Matches "+itoa(skillMatched)+" of "+itoa(skillRequested)+" requested skills")
		default:
			reasons = append(reasons, "No overlap with requested skills")
		}
	}
	if maxRiskAfter <= 100 {
		headroom := 100 - maxRiskAfter
		if headroom < 0 {
			headroom = 0
		}
		reasons = append(reasons, "Has "+itoa(headroom)+"% headroom in this range")
	} else {
		reasons = append(reasons, "Would exceed 100% capacity by "+itoa(maxRiskAfter-100)+"%")
	}
	if projectID != "" && hasProject {
		reasons = append(reasons, "Worked on this project before")
	}
	if levelFitScore < 1 {
		reasons = append(reasons, "Level differs from requested level")
	}
	if len(reasons) > 3 {
		reasons = reasons[:3]
	}
	return reasons
}

func itoa(n int) string {
	// simple int→string; Go 1.22 has strconv.Itoa but this avoids a one-off import
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func combineSignals(s Signals, w RecommendationWeights) float64 {
	return s.SkillMatch*w.Skill + s.LevelFit*w.Level + s.CapacityHeadroom*w.Capacity + s.ProjectAffinity*w.Affinity
}

// RankCandidates is the pure ranking function used by the handler and tests.
// It applies the hard ACTIVE filter, computes signals for each candidate,
// scores them, sorts by fit_score (tiebreak: more headroom), and trims to limit.
func RankCandidates(candidates []CandidateBA, q RecommendationQuery) []RecommendationResult {
	weights := DefaultWeights
	if q.Weights != nil {
		weights = *q.Weights
	}
	limit := q.Limit
	if limit <= 0 {
		limit = recommendationDefaultLimit
	}
	if limit > recommendationMaxLimit {
		limit = recommendationMaxLimit
	}

	results := make([]RecommendationResult, 0, len(candidates))
	for _, c := range candidates {
		if q.ExcludeBAIDs[c.ID] {
			continue
		}
		if c.Status != "ACTIVE" {
			continue
		}

		skill := skillMatch(c.SkillTagIDs, q.RequiredSkillIDs)
		matched := 0
		for _, want := range q.RequiredSkillIDs {
			for _, have := range c.SkillTagIDs {
				if want == have {
					matched++
					break
				}
			}
		}
		lf := levelFit(c.Level, q.Level)
		ch, maxAfter := capacityHeadroom(c, q)
		pa := projectAffinity(c, q)

		sigs := Signals{
			SkillMatch:       round2(skill),
			LevelFit:         round2(lf),
			CapacityHeadroom: round2(ch),
			ProjectAffinity:  round2(pa),
		}
		raw := combineSignals(sigs, weights) * 100
		fit := int(math.Round(raw))
		if fit < 0 {
			fit = 0
		}
		if fit > 100 {
			fit = 100
		}

		hasProject := q.ProjectBookingCounts[c.ID] > 0
		results = append(results, RecommendationResult{
			BAID:                 c.ID,
			FullName:             c.FullName,
			Level:                c.Level,
			Status:               c.Status,
			FitScore:             fit,
			Signals:              sigs,
			MaxRiskCapacityAfter: maxAfter,
			Reasons: buildReasons(
				sigs, matched, len(q.RequiredSkillIDs),
				maxAfter, hasProject, q.ProjectID, sigs.LevelFit,
			),
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].FitScore != results[j].FitScore {
			return results[i].FitScore > results[j].FitScore
		}
		// Tiebreak: more headroom wins.
		return results[i].MaxRiskCapacityAfter < results[j].MaxRiskCapacityAfter
	})
	if len(results) > limit {
		results = results[:limit]
	}
	return results
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// ParseSkillIDs splits the "required_skill_ids" query string into a unique
// slice. Accepts both comma-separated and repeated query params.
func ParseSkillIDs(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" || seen[part] {
				continue
			}
			seen[part] = true
			out = append(out, part)
		}
	}
	return out
}
