# COMPLETION REPORT — CAPACITY CONFLICT + MAN-DAY UTILIZATION LOGIC

## Status

DONE (code complete & verified file-by-file) — **but you must run the build/test commands yourself** (see note) and **repair the git index** (see Remaining Issues #1).

Scope agreed with you: **only the 2 biggest changes — overbook→conflict logic + the % next to BA on Timeline.** Action Center / Dashboard / Reports / AI Suggest / My Schedule were intentionally left untouched.

Stack note: the construction plan was written for a TypeScript/Prisma backend, but this project is **Go (apps/api) + React/TS (apps/web)**. Plan code was treated as reference and mapped to the real code.

## Summary

- **Overbook logic fixed.** A BA is no longer labelled `OVERBOOKED` just because pending requests *could* exceed 100%. That state is now `conflict_risk` (a signal to resolve). `OVERBOOKED`/`invalid_overbook` is reserved for the real data issue: already-approved capacity > 100%.
- Approving over 100% was already blocked by the API; the block now returns an **actionable message** with the most-constraining day, how much is already approved, and the **max capacity you can still approve** (e.g. reduce to 30%).
- **% next to BA on Timeline now = man-day utilization for the current view** (week/month/quarter) instead of the meaningless peak `approved+pending`. A separate red **Conflict / Invalid** chip appears when there's pending conflict risk, with a tooltip explaining the man-day basis. Capacity sort now uses utilization.
- Weekend exclusion and date-range (no hourly) booking are unchanged.
- **Man-day now counts COMPLETED work.** The Timeline %, BA list, and per-BA utilization endpoint previously counted only APPROVED + IN_PROGRESS; they now include COMPLETED (matching Reports), so the man-day metric reflects work actually done — suitable for payroll. The conflict/approve guard deliberately still ignores COMPLETED (finished work doesn't consume future capacity).

## Files Changed

| File | Change |
|---|---|
| apps/api/cmd/api/models.go | `BAListItem` gains `conflict_risk`, `invalid_overbook` |
| apps/api/cmd/api/ba_handlers.go | `/api/ba` no longer forces label to OVERBOOKED on pending risk; emits conflict/invalid flags; label = utilization |
| apps/api/cmd/api/remaining_handlers.go | `/api/capacity/summary` label now from utilization; adds `conflict_risk`, `invalid_overbook` |
| apps/api/cmd/api/capacity.go | New pure `approveConflictDetail()` (blocking day + existing approved + suggested max) |
| apps/api/cmd/api/booking_handlers.go | `approvalConflictInfo()` + `capacityConflictMessage()`; richer block messages on direct-book / approve / assign |
| apps/api/cmd/api/booking_mutations.go | Same richer block message on update / approve-changes |
| apps/api/cmd/api/capacity_conflict_test.go | **New** unit tests (conflict block, suggested max, conflict-vs-invalid, weekend, week/month utilization) |
| apps/web/src/lib/api.ts | `BAProfile` gains `conflict_risk`, `invalid_overbook` |
| apps/web/src/pages/TimelinePage.tsx | % = man-day utilization + Conflict/Invalid chip + tooltip; sort by utilization; terminology Overbook→Conflict (legend, booking bar, Booking Detail panel + suggested max approve) |

## Logic Changes

| Area | Before | After |
|---|---|---|
| Pending conflict | Labelled `OVERBOOKED` | `conflict_risk` flag; label stays at approved utilization |
| Approved over 100% | Blocked, terse message | Blocked, message names day + already-approved% + max approvable% |
| Overbook terminology | "Overbooked" used for pending risk | "Capacity conflict" (pending) vs "Invalid overbook" (approved>100, data issue) |
| BA % on Timeline | peak `approved+pending` (risk_capacity) | man-day utilization for the view; conflict shown separately |
| Man-day status set | utilization counted APPROVED + IN_PROGRESS only | utilization counts APPROVED + IN_PROGRESS + **COMPLETED** (for payroll); conflict guard still APPROVED + IN_PROGRESS |
| Weekend calculation | Excluded (workingDaysInRange) | Unchanged — still excluded |

## Test Results

Unit tests were **written but not executed in this environment** — the sandbox has no Go toolchain and the Linux mount could not run `go test`. Run them on your machine: `cd apps/api && go test ./...`

| Case | Expected | Test |
|---|---|---|
| Approve conflict blocked + suggested max 30% | blocked, existing 70, max 30 | TestApproveConflictBlockedWithSuggestedMax |
| Reduce to total 100% allowed | allowed | TestApproveAllowedWhenTotalAtHundred |
| Pending overlap = conflict not invalid | conflict_risk true, invalid false | TestPendingOverlapIsConflictNotInvalid |
| Two approved >100 = invalid overbook | invalid true, conflict false | TestApprovedOverlapIsInvalidOverbook |
| classifyCapacity by utilization | OVERBOOKED only when >100 | TestClassifyCapacityByUtilization |
| Weekend excluded (Fri→Mon 100%) | 2 man-days | TestWeekendExcludedFromManDays |
| Week utilization (5d × 50%) | 50% | TestWeekUtilizationHalfCapacity |
| Month utilization (11/22) | 50% | TestMonthUtilizationFormula |

## UI Verification (Timeline)

| Element | Result |
|---|---|
| % next to BA name | Now man-day utilization for week/month/quarter, colour-coded; tooltip explains man-days + pending conflict |
| Conflict indicator | Red "Conflict" chip (or "Invalid" if approved>100) replaces the old "Overbooked" number badge |
| Legend | "Overbooked BA" → "Capacity conflict" |
| Booking bar (week) | "- Overbooked" → "- Conflict" |
| Booking Detail panel | "Overbooked capacity" → "Capacity conflict" / "Invalid overbook"; shows **Max capacity you can approve** + resolution options |
| Capacity sort | Sorts by utilization % (was risk peak) |

Verified by reading every edited file back from disk; the React app could not be type-checked end-to-end here because `node_modules` symlinks resolve to Windows paths unavailable in the sandbox. Run `pnpm typecheck && pnpm build` on your machine.

## Business Rule Confirmation

- [x] No hourly booking added.
- [x] Date-range booking preserved.
- [x] Pending conflict still allowed (create not blocked; warning returned).
- [x] Approved capacity over 100% blocked (now with actionable message).
- [x] "Overbook" no longer used as a normal state (pending = conflict).
- [x] Utilization calculated by man-day.
- [x] Weekends excluded.

## Remaining Issues

| Issue | Severity | Recommendation |
|---|---|---|
| **git index corrupted** — a `git stash` I ran to compare a baseline crashed on the flaky mount, corrupting `.git/index` and leaving a stale `.git/index.lock`. **No source files or commits were lost** (all verified intact). | High (blocks git) | From Windows in `D:\gitHub\BA`: `del .git\index.lock` then `del .git\index` then `git reset` (or `git read-tree HEAD`). `git status` will then show your WIP + these changes, unstaged. |
| Run the plan's verify commands | Required | `pnpm lint && pnpm typecheck && pnpm build && pnpm test` and `go build ./... && go test ./...` and `pnpm db:seed`. |
| `classifyCapacity`/`CapacityClassification` enum value `OVERBOOKED` kept as-is | Low (intentional) | Left unchanged so Dashboard/BADirectory/Badges (out of agreed scope) don't break. It now only appears for genuine approved>100 data. Rename later if you do the full sweep. |
| Approve guard checks every calendar day, not only working days | Low | Capacity is constant across a date range, so the max is identical; only a booking overlapping *exclusively* on a weekend would be affected. Add working-day filtering if you ever need that edge case. |
| Seed cleanup (plan §9) | Info | Out of scope; not done. |

## Update — Terminology sweep across remaining pages (§8.2–8.6)

Followed up by replacing the visible "Overbook / Overbook risk" wording on every other screen. Rule applied: pending that could exceed 100% = **"Capacity conflict"**; already-approved over 100% (data issue) = **"Invalid overbook"**. Internal identifiers (URL params like `overbookRisk`, enum values like `OVERBOOK_RISK`/`OVERBOOKED`, JSON fields `overbooked_count`) were kept so deep-links and wiring don't break.

| Screen / source | Before | After |
|---|---|---|
| Action Center (ManagerInboxPage) | "Overbook risk" tab, filter, chip, flag | "Capacity conflict" |
| Create Request (BookingModal) | "Overbook risk", "Why this is risky", "No overbook risk detected", "X risk days" | "Capacity conflict", "Why this conflicts", "No capacity conflict detected", "X conflict days" |
| Dashboard (DashboardPage) | "Overbooked" stat/chip/flag (approved>100) | "Invalid overbook" / compact "Invalid"; "X BA with invalid overbook" |
| Reports (ReportsPage) | "Overbooked" stat (counts risk>100) | "Capacity conflicts" |
| Landing (LandingPage) | "Overbook risk" demo stat | "Capacity conflict" |
| Shared label (format.ts) | capacity_label OVERBOOKED → "Overbooked" | → "Invalid overbook" (flows to BA Directory, BA Profile, Badges) |
| AI summary highlight (AISummaryCard) | highlighted "overbooked"/"overbook risk" | highlights "capacity conflict"/"conflict"/"invalid overbook" |
| Backend capacity explain (remaining_handlers.go + test) | "No overbook risk detected…" | "No capacity conflict detected…" |
| Backend report label (report_handlers.go) | forced capacity_label OVERBOOKED when risk>100 (same bug as Timeline) | label from utilization; conflict tracked via risk_capacity |
| Dashboard/Reports/My-Schedule AI text (3 LLM handlers) | "overbooked BAs", "Check overbooked BAs", "overbooked this week", "could overbook X more BA" | "capacity conflict", "Check capacity conflicts", "over capacity this week", "could put X more BA in capacity conflict"; LLM guidance now told never to say "overbooked" |

Verified with the Grep tool: no user-visible "Overbook/Overbooked" strings remain (only internal variable names like `hasOverbooked`, enum values, JSON field names, and code comments). Renamed fact keys (`over_capacity_bas`, `capacity_warning`, `ba_that_would_conflict`) checked for orphan references — none. Files were read back via the editor to confirm integrity (the Linux shell mount truncates file tails on read, so shell-side `tsc`/`grep` were not trusted for final verification). **Run `pnpm typecheck && pnpm build` and `go build ./... && go test ./...` on your machine to confirm.**
