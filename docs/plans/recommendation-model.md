# BA Recommendation Model — Design

## 1. Goal

Recommend the best BAs to assign a given booking (or to highlight on the
Timeline when a user hovers a date range). The same engine is reused
for three use cases:

1. **Action Center** — rank BAs for a PENDING/NEEDS_ASSIGNMENT request
2. **BA Directory** — sort/score every BA on a `fit` 0–100 scale
3. **Timeline hover overlay** — soft-highlight BAs with best match for
   a hovered date range

## 2. Non-goals

- No schema changes. The engine derives everything from `ba_profiles`,
  `ba_skill_tags`, `skill_tags`, `bookings`, `projects`.
- No ML / training. Pure deterministic scoring from current state.
- No new RBAC. Reads only what `/api/ba` and `/api/bookings` already read.

## 3. Signals

For each candidate BA we compute four normalized 0–1 signals, then
fold them into one `fit_score` (0–100) using a weighted sum.

| Signal | Formula (normalized to 0–1) | Default weight |
| --- | --- | --- |
| **Skill match** | `|candidate ∩ requested| / |requested ∪ candidate|` (Jaccard). If no `required_skill_ids` are passed, signal is `1.0` (neutral). | 0.40 |
| **Level fit** | `1 - clamp(|level_rank(ba) - level_rank(requested)| / 3, 0, 1)`. If no `level` passed, signal is `1.0`. `level_rank` = JUNIOR=0, MIDDLE=1, SENIOR=2, LEAD=3. | 0.15 |
| **Capacity headroom** | `1 - clamp((max_risk_capacity_over_range + requested_capacity_percent) / 200, 0, 1)`. Uses existing `getRangeCapacity` so weekend/holiday handling is identical to the rest of the app. A BA who would go over 100% risk capacity scores `0`. | 0.35 |
| **Project affinity** | If `project_id` passed: `bookings_for_(ba, project) / max(1, total_bookings_for_ba)` capped at 1. Otherwise `0.5` (neutral). | 0.10 |

Final `fit_score = round(100 * (0.40·skill + 0.15·level + 0.35·capacity + 0.10·affinity))`.

### Why these weights

- **Skill (0.40)** — strongest signal, but Jaccard is forgiving (soft match
  was the user decision). A BA missing one of three tags still scores
  ~0.67 on this signal, not zero.
- **Capacity (0.35)** — second strongest. Recommending someone who is
  already overbooked is a footgun; this is the single biggest
  user-facing quality lever.
- **Level (0.15)** — tiebreaker, not a hard requirement. A junior can
  still be the right pick for a low-priority short task.
- **Affinity (0.10)** — gentle nudge for continuity on a project.

Total: 1.00, sum to 100% of the final score.

## 4. Inputs (request shape)

```ts
type RecommendQuery = {
  start_date: string;          // ISO YYYY-MM-DD, required
  end_date: string;            // ISO YYYY-MM-DD, required
  capacity_percent: number;    // 1–100, required
  required_skill_ids?: string[]; // soft match
  level?: 'JUNIOR'|'MIDDLE'|'SENIOR'|'LEAD';
  project_id?: string;
  limit?: number;              // default 5, max 25
  exclude_ba_ids?: string[];   // for "show me more"
};
```

Validation:

- `end_date >= start_date`
- `1 <= capacity_percent <= 100`
- `limit` clamped to `[1, 25]`

## 5. API

```
GET /api/ba/recommendations
  ?start_date=2026-06-09
  &end_date=2026-07-09
  &capacity_percent=50
  &required_skill_ids=tag1,tag2
  &level=SENIOR
  &project_id=...
  &limit=5
```

Response:

```json
{
  "query": { "start_date": "...", "end_date": "...", "capacity_percent": 50 },
  "results": [
    {
      "ba_id": "...",
      "full_name": "Tran Minh",
      "level": "SENIOR",
      "status": "ACTIVE",
      "fit_score": 87,
      "signals": {
        "skill_match": 0.75,
        "level_fit": 1.0,
        "capacity_headroom": 0.80,
        "project_affinity": 0.5
      },
      "max_risk_capacity_after": 90,
      "reasons": [
        "Matches 3 of 4 requested skills",
        "Has 40% headroom in this range",
        "Worked on this project twice before"
      ]
    }
  ]
}
```

`reasons` is human-readable copy generated from the top signals (top
2–3 only, to keep it short). The endpoint reuses `getRangeCapacity` and
the existing `ba_profiles.findMany` filters, so cost is bounded:
`O(BAs × bookings_per_BA_in_range)`.

## 6. Filters applied before scoring

- `status = ACTIVE` (RESIGNED and ON_LEAVE BAs are excluded — same rule
  the existing `BAService.list` applies for PM/PO viewers).
- `currentUser.role === 'BA'` → only their own profile.
- `exclude_ba_ids` is honored after scoring (still ranked, just trimmed
  from the response).

## 7. UI surfaces (priority order this PR)

1. **Timeline hover overlay** — when the user hovers a date range on
   the BA column headers, show a small floating panel with the top 3
   recommended BAs for that range. Visual: a 3px top border in
   `emerald-500` on the BA row, plus a tooltip card.

2. **BA Directory** — show `fit_score` as a sortable column. Default
   sort: `fit_score` desc, requires a date range filter (otherwise
   score is the capacity + skill neutral).

3. **Action Center** — "Suggest a BA" panel next to a request (uses the
   same `useQuery` hook).

All three use one hook: `useBARecommendations(query)`. The hook lives
in `apps/web/src/lib/recommendations.ts` and is debounced (250ms) so
hover events don't fire a request per pixel.

## 8. Out of scope (next iterations)

- Per-tenant weight tuning (use defaults for now).
- Suggesting BAs that don't exist (no auto-hire).
- Cross-project affinity for the project-matching endpoint.
- Caching layer — current scale (tens of BAs, hundreds of bookings)
  doesn't need one yet.

## 9. Files to add / change

- **New backend** `apps/api/src/recommendations/`
  - `recommendations.service.ts` — pure scoring functions  *(abandoned: NestJS src/ is dead code in this branch — the Go API is the live binary)*
  - `recommendations.controller.ts` — `GET /api/ba/recommendations`  *(abandoned)*
  - `recommendations.module.ts` — wire it in  *(abandoned)*
- **Live Go implementation** `apps/api/cmd/api/`
  - `recommendations.go` — pure scoring engine (`RankCandidates`, signal helpers, `ParseSkillIDs`)
  - `recommendations_handler.go` — `GET /api/ba/recommendations`; loads candidates from `ba_profiles` + `ba_skill_tags`, fetches overlapping bookings in one IN-clause query, loads per-(ba, project) and per-ba total counts for affinity, then projects into `CandidateBA` and calls the pure ranker
  - `recommendations_test.go` — 31 unit tests covering each signal, hard filters, limit clamping, reasons, and an end-to-end ranking
  - `router.go` — adds `r.Get("/ba/recommendations", app.handleRecommendations)`
- **Frontend** `apps/web/src/lib/recommendations.ts` — typed client +
  `useBARecommendations` hook.
- **Frontend** `apps/web/src/components/timeline/RecommendationOverlay.tsx`
  — hover overlay component.
- **Frontend** `apps/web/src/pages/TimelinePage.tsx` — wire the overlay
  onto BA column headers.

### Implementation notes

- **Auth**: BA_MANAGER, ADMIN, PM_PO can request. BA users are scoped to
  their own profile (same rule as `handleBAList`).
- **SQL**: All `id` columns are `uuid`, so all IN-array parameters cast
  to `::uuid[]`. Skill narrowing is done at the SQL level (EXISTS
  subquery) to cut IO; the scorer still does soft Jaccard.
- **Booking window**: handler fetches bookings overlapping
  `[start_date - 90d, end_date + 90d]` so the capacity engine sees
  every relevant overlap.
- **Limits**: `limit` is clamped to `[1, 25]`; default 5.
- **No project_id**: project_affinity returns a neutral 0.5, so the
  observable max `fit_score` without a project is 95 (with capacity 0
  requested), not 100. The unit tests lock this.
