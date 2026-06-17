# VIBECODE REPAIR PLAN — BA Bazaar / BA Booking CRM

# Sửa sản phẩm theo feedback business review

## 0. Role

You are the **Builder / Thợ thi công**.

The product has already been implemented and deployed. Your job is to repair and improve the product according to business feedback from the reviewer.

Follow this workflow:

```txt
SCAN → UNDERSTAND CURRENT IMPLEMENTATION → IMPLEMENT PRIORITY FIXES → TEST → REPORT
```

Do not redesign the whole app from scratch.
Do not change the core booking model.
Do not add hourly booking.
Do not break existing working flows.

---

## 1. Project Context

Project: **BA Bazaar / BA Booking CRM**

Product purpose:

* Help BA Manager manage BA allocation.
* Help PM/PO create BA booking requests.
* Help BA see assigned work.
* Help organization understand BA utilization, bench rate, man-day, and workload.

Current stack:

```txt
Frontend: React + Vite + TypeScript + Tailwind/shadcn
Backend: NestJS + TypeScript
Database: PostgreSQL + Prisma
Package manager: pnpm
Deploy: Docker Compose / VPS
```

Core rule:

```ts
Booking uses:
start_date
end_date
capacity_percent
```

Forbidden:

```ts
start_time
end_time
start_datetime
end_datetime
hourly booking
```

---

## 2. Main Feedback to Fix

The reviewer feedback can be summarized into 6 big problems:

1. **Dashboard is not business/action-focused enough.**

   * It should not just show generic capacity summary.
   * BA Manager wants to see what needs action immediately.

2. **Missing business metrics for outsourcing/resource planning.**

   * Need man-day.
   * Need utilization by BA/project/team.
   * Need bench rate.
   * Need project effort allocation.
   * Optional financial/budget placeholder.

3. **Timeline does not highlight overbook clearly.**

   * 100% and >100% currently look too similar.
   * BA Manager must instantly see overbooked BA.

4. **BA Directory does not show capacity/project status directly.**

   * Manager/PMPO should not need to click profile to know BA workload.

5. **Navigation is confusing.**

   * Manager Inbox and Notification overlap.
   * Mobile bottom navigation has too many items.
   * Role-based navigation should be cleaner.

6. **UI is too box-heavy and not focused on action.**

   * Too many large cards.
   * Not enough compact list/table views.
   * Need obvious CTA and flagged items.

---

## 3. Priority Levels

## P0 — Must fix before next review/demo

1. Dashboard Manager action-first.
2. PM/PO Create Request CTA must remain clear.
3. Timeline overbook visual must be obvious.
4. BA Directory must show capacity/project status on the list.
5. Navigation cleanup: reduce duplicate Inbox/Notification confusion.
6. Compact request/action list.

## P1 — Should fix during wrap

1. Man-day calculation.
2. Team utilization by week/month/quarter.
3. Utilization by BA and project.
4. Bench rate.
5. Project effort distribution.
6. Compact month/quarter planning view.

## P2 — Optional / next phase

1. Financial/budget calculation.
2. BA daily rate.
3. Income vs BA cost.
4. Recommendation engine for overbook/bench.
5. Training suggestion for bench BA.

---

## 4. Required Current-State Scan

Before editing code, scan the current implementation.

Check:

```txt
apps/web/src
apps/api/src
packages/shared
prisma/schema.prisma
prisma/seed.ts
docker-compose.*
```

Find these files or equivalents:

```txt
Dashboard page
Timeline page
BA Directory page
Manager Inbox page
Notification page
Reports page
Booking service
Capacity service
BA service
Report/utilization service
Navigation/Layout shell
```

Search commands:

```bash
grep -R "Dashboard\|Timeline\|Inbox\|Notification\|capacity\|utilization\|manDay\|man_day\|bench" apps web apps/api packages prisma
```

PowerShell equivalent:

```powershell
Select-String -Path "apps/**/*.*","packages/**/*.*","prisma/**/*.*" -Pattern "Dashboard|Timeline|Inbox|Notification|capacity|utilization|manDay|man_day|bench"
```

Output a short scan summary before implementation:

```md
# CURRENT IMPLEMENTATION SCAN

## Found Pages
| Page | File | Notes |
|---|---|---|

## Found Services
| Service | File | Notes |
|---|---|---|

## Existing Metrics
| Metric | Exists? | Notes |
|---|---|---|

## Gaps to Fix
| Gap | Priority | File likely affected |
|---|---|---|
```

---

# TASK GRAPH

```txt
TIP-001: Business metrics foundation
    ├── TIP-002: Manager dashboard action-first remake
    ├── TIP-003: Timeline overbook and compact planning view
    ├── TIP-004: BA Directory capacity/project status
    ├── TIP-005: Navigation cleanup
    ├── TIP-006: Request/Inbox compact list and action flags
    └── TIP-007: QA + regression verification
```

---

# TIP-001 — Business Metrics Foundation: Man-day, Utilization, Bench Rate

## Goal

Add or standardize calculation utilities for:

* Man-day.
* Utilization.
* Bench rate.
* Project effort distribution.
* BA capacity level.

This is the foundation for Dashboard, Timeline, BA Directory and Reports.

## Business Definitions

### 1. Man-day

```txt
man_day = working_days_in_booking_range × capacity_percent / 100
```

Example:

```txt
10 working days × 100% = 10 man-days
10 working days × 50% = 5 man-days
```

Use working days if the project already has working-day logic.
If not, use date range days first and clearly document limitation.

### 2. BA available man-days

```txt
available_man_days = working_days_in_timeframe × 1.0
```

For each BA.

### 3. Utilization

```txt
utilization_percent = booked_man_days / available_man_days × 100
```

### 4. Bench

A BA is considered bench in a selected timeframe if:

```txt
utilization_percent == 0
```

### 5. Bench rate

```txt
bench_rate = bench_BA_count / total_BA_count × 100
```

### 6. Capacity classification

Use this mapping:

```txt
0%        = BENCH
1–49%     = LOW
50–74%    = AVAILABLE
75–99%    = HIGH
100%      = FULL
>100%     = OVERBOOKED
```

## Backend Requirements

Create or update utility/service:

```txt
capacity.service.ts
utilization.service.ts
reports.service.ts
```

Functions needed:

```ts
calculateBookingManDays(booking)
calculateBAUtilization(baId, timeframe)
calculateTeamUtilization(timeframe)
calculateBenchRate(timeframe)
calculateProjectManDays(projectId, timeframe)
classifyCapacity(utilizationPercent)
```

If time is limited, implement these in the existing capacity/report service.

## API Requirements

If not already available, add or update endpoints:

```http
GET /api/dashboard/manager-summary?from=&to=
GET /api/analytics/team-utilization?from=&to=
GET /api/analytics/project-effort?from=&to=
GET /api/ba/:id/utilization?from=&to=
```

Response example for manager summary:

```json
{
  "timeframe": {
    "from": "2026-06-01",
    "to": "2026-06-30"
  },
  "team": {
    "total_ba": 15,
    "team_utilization_percent": 76,
    "bench_count": 2,
    "bench_rate_percent": 13.3,
    "overbooked_count": 1,
    "total_man_days": 182
  },
  "actions": {
    "pending_requests": 8,
    "unassigned_requests": 3,
    "urgent_requests": 2,
    "overbooked_ba": 1,
    "bench_ba": 2
  }
}
```

## Acceptance Criteria

* [ ] Man-day calculation exists.
* [ ] Utilization calculation exists.
* [ ] Bench rate calculation exists.
* [ ] Capacity classification exists.
* [ ] Team summary API returns pending/unassigned/urgent/overbooked/bench counts.
* [ ] No hourly booking fields added.
* [ ] Existing booking flow still works.

## Required Tests

Add unit tests for:

* [ ] 10 days × 100% = 10 man-days.
* [ ] 10 days × 50% = 5 man-days.
* [ ] Utilization 15/20 = 75%.
* [ ] Utilization 0 = BENCH.
* [ ] Utilization 120 = OVERBOOKED.
* [ ] Bench rate calculation.

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

---

# TIP-002 — Remake BA Manager Dashboard: Action-First Dashboard

## Goal

Change BA Manager Dashboard from generic capacity summary into an action-first business dashboard.

BA Manager should immediately see:

* Requests requiring action.
* Unassigned requests.
* Urgent requests.
* Overbooked BA.
* Bench BA.
* Team utilization.
* Man-day this month.
* Project effort distribution.

## UI Structure

Manager Dashboard should have:

```txt
Top section:
- Pending Requests
- Unassigned Requests
- Overbooked BA
- Bench BA
- Team Utilization
- Man-days This Month

Main section:
- Priority Action List

Secondary section:
- Team Utilization Trend
- Project Effort Distribution
- Capacity Distribution
```

## Remove / Reduce

* Do not make “capacity tổng” the main hero.
* Reduce large decorative cards.
* Use compact cards and table/list rows.
* Important actions should appear above charts.

## Priority Action List

This should be the most important block.

Rows should include:

```txt
Type | Priority | Project | Requester | Date Range | Capacity | Assigned BA | Flag | Action
```

Action types:

```txt
PENDING_REQUEST
UNASSIGNED_REQUEST
OVERBOOKED_BA
BENCH_BA
URGENT_REQUEST
```

Flags:

```txt
URGENT
UNASSIGNED
OVERBOOKED
BENCH
CAPACITY_RISK
```

Actions:

* Review request.
* Assign BA.
* Approve.
* Reject.
* View Timeline.
* View BA.

## Dashboard Timeframe

Add timeframe controls:

```txt
This week
This month
This quarter
Custom
```

Default:

```txt
This month
```

## Acceptance Criteria

* [ ] Dashboard opens with action list, not capacity hero.
* [ ] Pending requests visible immediately.
* [ ] Unassigned requests visible immediately.
* [ ] Overbooked BA visible immediately.
* [ ] Bench BA visible immediately.
* [ ] Team utilization visible.
* [ ] Total man-day visible.
* [ ] Timeframe selector works.
* [ ] Action rows link to request detail / assign flow / timeline / BA profile.
* [ ] PM/PO and BA cannot access Manager Dashboard.

## Manual Test

1. Login as BA Manager.
2. Open dashboard.
3. Verify action list is the main view.
4. Create pending request.
5. Verify it appears in action list.
6. Create unassigned request.
7. Verify it appears with `UNASSIGNED`.
8. Create/seed overbooked BA.
9. Verify `OVERBOOKED` flag appears.
10. Verify bench BA appears.
11. Switch month/quarter timeframe.

## Files Likely Affected

```txt
apps/web/src/pages/DashboardPage.tsx
apps/web/src/pages/ManagerDashboardPage.tsx
apps/web/src/components/*
apps/api/src/dashboard/*
apps/api/src/reports/*
apps/api/src/capacity/*
```

---

# TIP-003 — Timeline: Overbook Highlight + Compact Month/Quarter View

## Goal

Make Timeline more useful for BA Manager planning.

Problems to fix:

* 100% and >100% look too similar.
* Overbooked BA must stand out.
* Manager needs compact month/quarter view.
* Timeline should show effort/capacity clearly.

## Required Visual Rules

Capacity color mapping:

```txt
0%        Bench       gray / light
1–49%     Low         light blue
50–74%    Available   green
75–99%    High        amber
100%      Full        purple / strong blue
>100%     Overbooked  red/orange high contrast
```

Overbook must have:

* Warning icon.
* High-contrast color.
* Label `Overbooked`.
* Tooltip/detail explaining why.

## Overbook Detail

When clicking overbooked BA/booking:

Show:

* BA name.
* Total utilization.
* Projects contributing.
* Each project capacity %.
* Date range.
* Which booking causes over 100%.
* Suggested action:

  * View available BA.
  * Move part of effort.
  * Reject pending request.
  * Assign different BA.

## Compact View

Add or improve view modes:

```txt
Week
Month
Quarter
```

### Week view

* Show more detailed booking bars.

### Month view

* Show compact utilization blocks.
* Reduce horizontal scrolling.
* Summarize BA capacity per month.

### Quarter view

* Show planning overview.
* Columns can be months or weeks.
* Focus on utilization/bench/overbook trends.

## Acceptance Criteria

* [ ] >100% capacity is visually different from exactly 100%.
* [ ] Overbooked BA has warning flag.
* [ ] Clicking overbook shows breakdown by project/booking.
* [ ] 0% BA is clearly shown as bench.
* [ ] Month view is compact enough to see more overview.
* [ ] Quarter view exists or is explicitly implemented as compact month grouping.
* [ ] Timeline still supports existing booking bars.
* [ ] No hourly booking added.

## Manual Test

1. Seed BA with 100%.
2. Seed BA with 120%.
3. Open timeline.
4. Verify 100% and 120% look different.
5. Click 120% BA.
6. Verify breakdown is visible.
7. Switch week/month/quarter.
8. Verify layout does not require excessive horizontal drag in month/quarter.

## Files Likely Affected

```txt
apps/web/src/pages/TimelinePage.tsx
apps/web/src/components/timeline/*
apps/web/src/lib/capacity*
apps/api/src/capacity/*
```

---

# TIP-004 — BA Directory: Show Capacity, Projects and CTA Directly

## Goal

BA Directory should not require clicking into profile just to know who is available.

Manager/PMPO should see at list level:

* BA current capacity.
* BA status.
* Current project allocation.
* Skill tags.
* CTA to request/assign BA.

## Required BA Row/Card Data

Each BA item should show:

```txt
Name
Level
Skills/tags
Status
Current capacity %
Capacity label
Current projects
CTA
```

Example:

```txt
Nguyen Van A | Senior BA | Fintech, BPMN | Project X 50%, Project Y 25% | Total 75% | Request BA
```

## Capacity Label Rules

```txt
0%        Bench
1–49%     Low utilization
50–74%    Available
75–99%    High utilization
100%      Full
>100%     Overbooked
```

## CTA Rules

For PM/PO:

```txt
Request BA
```

For BA Manager:

```txt
Assign to Request
View Timeline
View Profile
```

For inactive BA:

* On Leave: disable request.
* Resigned: disable request.
* Show reason/status.

## Acceptance Criteria

* [ ] BA Directory shows capacity % without opening profile.
* [ ] BA Directory shows current projects.
* [ ] BA Directory shows capacity label.
* [ ] PM/PO can click Request BA from BA row/card.
* [ ] BA Manager can assign/view timeline/profile.
* [ ] On Leave/Resigned BA cannot be requested.
* [ ] Overbooked BA has visible warning.
* [ ] Bench BA is visible.

## Manual Test

1. Open BA Directory as Manager.
2. Verify all BA show capacity/project info.
3. Open as PM/PO.
4. Verify only Active BA can be requested.
5. Click Request BA.
6. Verify create request form opens prefilled with BA.
7. Verify overbooked/bench labels.

## Files Likely Affected

```txt
apps/web/src/pages/BADirectoryPage.tsx
apps/web/src/components/ba/*
apps/api/src/ba/*
apps/api/src/capacity/*
```

---

# TIP-005 — Navigation Cleanup: Role-Based, Less Confusing

## Goal

Simplify navigation by role.

Current issue:

* Too many navigation items.
* Manager Inbox and Notification overlap.
* Mobile bottom bar has too many buttons.
* Users may not know where to go.

## Navigation Target

### BA Manager

```txt
Dashboard
Timeline
BA Directory
Reports / Analytics
```

Manager action should be in Dashboard / Action Center.

Notification should be:

* Icon/badge only, or
* Tab inside Action Center, not separate major nav item.

### PM/PO

```txt
Create Request / My Requests
Timeline
BA Directory
```

PM/PO must always see clear CTA:

```txt
Create Request
```

### BA

```txt
My Schedule
My Tasks / Assigned Projects
Profile
```

BA should not see Manager menus.

## Manager Inbox vs Notification

Choose one of these options.

### Preferred MVP Option

```txt
Manager Inbox = Action Center
Notification = small bell icon / badge
```

Do not show both as two equal navigation pages.

If a Notification page still exists:

* Rename to Activity.
* Keep it secondary.
* Do not confuse it with action queue.

## Mobile

Do not show 6 bottom buttons.

Mobile options:

* Use sidebar/drawer.
* Or show max 3 primary nav items per role.
* Hide role-irrelevant pages.

## Acceptance Criteria

* [ ] BA Manager navigation has fewer focused items.
* [ ] PM/PO navigation clearly exposes Create Request / My Requests.
* [ ] BA navigation focuses on My Schedule / Tasks.
* [ ] Manager Inbox and Notification are not confusing duplicates.
* [ ] Mobile does not show 6 bottom nav items.
* [ ] Role-based menu hides irrelevant items.
* [ ] Restricted routes still protected by RBAC.

## Manual Test

1. Login Manager.
2. Verify nav only has Manager-relevant items.
3. Login PM/PO.
4. Verify nav focuses request creation/tracking.
5. Login BA.
6. Verify nav focuses schedule/task.
7. Test mobile width.
8. Verify nav is not overcrowded.

## Files Likely Affected

```txt
apps/web/src/components/LayoutShell.tsx
apps/web/src/components/Navigation*
apps/web/src/App.tsx
apps/web/src/routes/*
```

---

# TIP-006 — Compact Inbox / Request List / Action Flags

## Goal

Make request/inbox view easier to scan.

Current issue:

* Too many large boxes.
* Manager cannot quickly see what needs action.
* Unassigned requests feel overwhelming.

## Required UI

Replace large request cards with compact rows/table where possible.

Columns:

```txt
Priority
Type
Project
Requester
Date Range
Capacity
Assigned BA
Risk
Status
Action
```

Type badge:

```txt
Specific BA
Open Request
```

Risk badge:

```txt
Overbook risk
Unassigned
Urgent
Bench candidate
```

Actions:

```txt
Review
Assign
Approve
Reject
View Timeline
```

## Sorting

Default sort:

1. Urgent first.
2. Unassigned pending.
3. Oldest pending.
4. Capacity risk.
5. Normal pending.

Add sort options if easy:

```txt
Priority
Created time
Capacity risk
Project
Requester
```

## Acceptance Criteria

* [ ] Inbox uses compact row/list view.
* [ ] Manager can see many requests at once.
* [ ] Urgent/unassigned/overbook risk are flagged.
* [ ] Open request requires assign action.
* [ ] Specific BA request can approve/reject directly.
* [ ] Reject requires reason.
* [ ] Approve still validates capacity.
* [ ] PM/PO cannot access Manager inbox/action center.

## Manual Test

1. Seed multiple pending requests.
2. Open Manager dashboard/inbox.
3. Verify many rows visible.
4. Verify unassigned requests stand out.
5. Verify urgent requests stand out.
6. Assign open request.
7. Approve specific BA request.
8. Reject request with reason.

## Files Likely Affected

```txt
apps/web/src/pages/ManagerInboxPage.tsx
apps/web/src/pages/DashboardPage.tsx
apps/web/src/components/requests/*
apps/api/src/bookings/*
```

---

# TIP-007 — QA + Regression Verification

## Goal

Ensure all fixes work and no existing core business rule is broken.

## Required Commands

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

If DB is needed:

```bash
pnpm db:validate
pnpm db:seed
```

If e2e exists:

```bash
pnpm test:e2e
```

## Required Manual QA

### Manager

* [ ] Dashboard shows action-first view.
* [ ] Pending requests visible.
* [ ] Open requests visible.
* [ ] Overbooked BA visible.
* [ ] Bench BA visible.
* [ ] Manager can assign open request.
* [ ] Manager can approve/reject.
* [ ] Manager can inspect overbook.

### PM/PO

* [ ] Create Request CTA visible.
* [ ] Can create specific BA request.
* [ ] Can create open request.
* [ ] Can track My Requests.
* [ ] Can see assigned BA after approval.
* [ ] Cannot approve/reject.

### BA

* [ ] Can view My Schedule.
* [ ] Can see assigned projects/tasks.
* [ ] Cannot create request.
* [ ] Cannot access manager dashboard.

### Business Metrics

* [ ] Man-day shown/calculated.
* [ ] Team utilization shown.
* [ ] Bench rate shown.
* [ ] Project effort distribution shown.
* [ ] Overbook >100% obvious.
* [ ] 0% bench visible.

### Navigation

* [ ] Manager nav is focused.
* [ ] PM/PO nav is focused.
* [ ] BA nav is focused.
* [ ] Inbox/Notification are not confusing duplicates.
* [ ] Mobile nav is not overcrowded.

## Business Rule Confirmation

* [ ] No hourly booking implemented.
* [ ] Booking still uses `start_date`, `end_date`, `capacity_percent`.
* [ ] Approved capacity >100% is flagged/blocked according to existing rule.
* [ ] Pending request can show risk warning.
* [ ] On Leave/Resigned BA cannot be booked.
* [ ] PM/PO cannot approve/reject.
* [ ] BA cannot create booking.
* [ ] Private notes remain Manager-only.

---

# Final Completion Report Format

Return this after implementation:

```md
# COMPLETION REPORT — BUSINESS DASHBOARD REPAIR

## 1. Status

DONE / PARTIAL / BLOCKED

## 2. Summary

- ...

## 3. Files Changed

| File | Change |
|---|---|

## 4. Implemented Fixes

| TIP | Status | Evidence |
|---|---|---|
| TIP-001 Business metrics | | |
| TIP-002 Manager dashboard | | |
| TIP-003 Timeline overbook | | |
| TIP-004 BA Directory capacity | | |
| TIP-005 Navigation cleanup | | |
| TIP-006 Compact inbox/action list | | |
| TIP-007 QA | | |

## 5. Business Metrics Added

| Metric | Status | Notes |
|---|---|---|
| Man-day | | |
| Team utilization | | |
| BA utilization | | |
| Project effort | | |
| Bench rate | | |
| Overbook count | | |

## 6. Manual QA Evidence

| Flow | Result | Evidence |
|---|---|---|
| Manager dashboard | | |
| PM/PO create request | | |
| BA schedule | | |
| Timeline overbook | | |
| BA Directory capacity | | |
| Navigation | | |

## 7. Commands Run

| Command | Result |
|---|---|
| pnpm lint | |
| pnpm typecheck | |
| pnpm build | |
| pnpm test | |
| pnpm db:seed | |

## 8. Remaining Issues

| Issue | Severity | Reason | Recommendation |
|---|---|---|---|

## 9. Business Rule Confirmation

- [ ] No hourly booking.
- [ ] Date-range booking preserved.
- [ ] Capacity percent preserved.
- [ ] RBAC preserved.
- [ ] Private notes preserved.
- [ ] Existing deploy not broken.

## 10. Final Recommendation

APPROVED / NEEDS WORK / BLOCKED
```

---

# Start Instruction

Start with the current-state scan, then implement TIP-001 through TIP-006 in order.

If time is short, prioritize:

```txt
1. Manager Dashboard action-first
2. Timeline overbook visual
3. BA Directory capacity visible
4. Navigation cleanup
5. Man-day/utilization/bench metrics
```

Do not attempt financial/budget calculation unless the above P0/P1 items are done.




## Bổ sung chỉnh sửa: Compact Timeline theo tuần/tháng

### Vấn đề hiện tại

Ở màn hình Timeline, khi xem booking theo tháng, các ô đang hiển thị quá chi tiết theo từng ngày nên người dùng phải kéo ngang nhiều để biết booking bắt đầu/kết thúc ở đâu. Điều này làm BA Manager khó nhìn tổng quan workload trong tháng.

### Hướng sửa

Bổ sung chế độ **Compact Month View**:

* Khi chọn view theo tuần: vẫn hiển thị chi tiết theo từng ngày trong tuần.
* Khi chọn view theo tháng: co timeline lại theo từng tuần, mỗi cột đại diện cho 1 tuần trong tháng.
* Khi chọn view theo quý: co tiếp theo tháng, mỗi cột đại diện cho 1 tháng.

### Cách hiển thị đề xuất

```txt
Week View:
Mon | Tue | Wed | Thu | Fri

Month View:
Week 1 | Week 2 | Week 3 | Week 4 | Week 5

Quarter View:
Month 1 | Month 2 | Month 3
```

### Booking bar trong Month View

Nếu booking kéo dài qua nhiều tuần, bar sẽ span qua các cột tuần tương ứng.

Ví dụ:

```txt
Booking: 04/06 → 18/06

Month View:
Week 1 | Week 2 | Week 3 | Week 4
        [====== Booking ======]
```

Không cần hiển thị chính xác từng ngày trong month view, chỉ cần giúp BA Manager nắm tổng quan:

* BA nào đang được book trong tuần nào.
* BA nào đang full.
* BA nào đang overbook.
* BA nào đang bench.
* Project nào đang chiếm effort nhiều.

### Tooltip / Detail

Khi hover hoặc click booking trong Month View, vẫn phải hiện chi tiết:

* Ngày bắt đầu.
* Ngày kết thúc.
* Project/task.
* Capacity.
* Status.
* PM/PO requester.
* Tổng man-day nếu đã có.

### Acceptance Criteria

* [ ] Week View vẫn hiển thị chi tiết theo ngày.
* [ ] Month View co lại theo tuần, không phải kéo ngang quá nhiều.
* [ ] Quarter View nếu có thì co theo tháng.
* [ ] Booking bar span đúng qua các tuần/tháng liên quan.
* [ ] Overbook >100% vẫn được highlight rõ trong compact view.
* [ ] BA Manager nhìn được tổng quan workload tháng mà không cần kéo ngang liên tục.
* [ ] Click/hover booking vẫn xem được ngày chính xác.
* [ ] Không thay đổi business logic booking.
* [ ] Booking vẫn dùng `start_date`, `end_date`, `capacity_percent`.
