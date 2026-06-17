# KẾ HOẠCH THI CÔNG CHO CODEX

# BA Bazaar / BA Booking + CRM BA Manager

## 0. Vai trò của Codex

Bạn là **Builder / Thợ thi công** trong quy trình Vibecode Kit.

Bạn phải:

1. Đọc toàn bộ tài liệu yêu cầu trước khi code.
2. Scan codebase hiện tại trước khi thay đổi.
3. Triển khai đúng phạm vi đã được duyệt.
4. Không tự ý đổi kiến trúc, đổi nghiệp vụ hoặc thêm feature ngoài scope.
5. Không triển khai booking theo giờ.
6. Booking phải theo đúng PRD gốc: `start_date`, `end_date`, `capacity_percent`.
7. Chỉ bổ sung module CRM cho BA Manager vào BA Bazaar.
8. Sau mỗi TIP phải tự test và trả Completion Report.
9. Nếu gặp mâu thuẫn spec, phải báo BLOCKED hoặc Escalation Report, không đoán mò.

---

## 1. Bối cảnh dự án

Dự án là **BA Bazaar**, một hệ thống nội bộ giúp BA Manager quản lý lịch phân công nguồn lực BA và giúp PM/PO tự tạo request đặt BA khi thấy BA còn slot trống.

Sản phẩm có 2 khối chính:

### 1.1 BA Booking / Resource Timeline

Đây là phần gốc theo PRD.

Mục tiêu:

* PM/PO xem được toàn cảnh BA nào đang bận/rảnh.
* PM/PO tạo booking request theo khoảng ngày.
* BA Manager approve/reject request.
* BA xem lịch cá nhân.
* Hệ thống có notification và report utilization.

Booking **không theo giờ**.

Booking dùng:

```ts
start_date: Date
end_date: Date
capacity_percent: 50 | 100
```

Không dùng:

```ts
start_datetime
end_datetime
start_time
end_time
```

### 1.2 CRM cho BA Manager

Đây là phần bổ sung vào PRD gốc.

Mục tiêu:

* BA Manager quản lý hồ sơ BA.
* Quản lý skill/domain tags.
* Quản lý trạng thái BA: Active / On Leave / Resigned.
* Xem private notes.
* Xem booking history.
* Xem utilization.
* PM/PO dùng thông tin public của BA để chọn BA phù hợp hơn khi tạo request.

---

## 2. Phạm vi tổng thể

## 2.1 In Scope

### Booking Module

* Resource Timeline dạng Gantt-style.
* Timeline theo ngày/tuần/tháng.
* Filter theo BA.
* Filter theo project.
* Nút Today.
* Hiển thị slot trống.
* Hiển thị booking bar.
* Click slot trống để tạo request.
* Click booking bar để xem chi tiết.
* PM/PO tạo booking request.
* BA Manager approve/reject booking request.
* BA Manager tạo booking trực tiếp.
* PM/PO xem My Requests.
* BA Manager xem Inbox pending requests.
* BA xem My Schedule.
* Notification in-app.
* Export report CSV.

### CRM Module

* BA Directory.
* BA Profile.
* Create/update BA profile.
* Skill/domain tags.
* Filter BA theo skill/domain khi booking.
* Status gating: On Leave/Resigned không cho book.
* Private notes append-only.
* Booking history.
* Utilization stats.
* PM/PO public BA card.
* Audit log cho mutation.
* RBAC API-level.

### Seed Data

Backend cần có seed data:

* 15 BA với đầy đủ profile, level, avatar, skill/domain tags, status.
* 5 PM/PO.
* 1 BA Manager.
* Một số project mẫu.
* Một số booking mẫu đủ trạng thái: Pending, Approved, Rejected, In Progress, Completed, Cancelled.
* Một số private notes mẫu chỉ Manager thấy.

---

## 2.2 Out of Scope

Không triển khai trong bản này:

* Booking theo giờ.
* Google Calendar / Outlook integration.
* Recurring booking.
* AI matching.
* Rating/feedback sau booking.
* Multi-level approval.
* BA tự block lịch nghỉ phép.
* Zalo/email/push notification ngoài app.
* HRIS integration.
* PDF export.
* Performance review / 360 feedback.
* Hard delete BA trong UI Manager.

---

## 3. Tech Stack đề xuất

Nếu repo hiện tại đã có stack, ưu tiên reuse stack hiện có.

Nếu bắt đầu từ đầu, dùng stack sau:

### Frontend

* React + TypeScript.
* Vite.
* Responsive web-first, có thể build tốt cho desktop/tablet/mobile.
* Tailwind CSS.
* React Router.
* TanStack Query cho server state.
* Zustand hoặc Context nhỏ cho UI state nếu cần.
* Recharts hoặc lightweight chart library cho utilization.
* Date-fns cho xử lý ngày.
* Không dùng booking theo giờ.

### Backend

* Node.js + TypeScript.
* NestJS hoặc Express.
* Prisma ORM.
* PostgreSQL.
* Zod hoặc class-validator cho validation.
* JWT-based auth mock/internal auth.
* RBAC middleware.
* Audit log middleware/service.

### Database

* PostgreSQL.
* Prisma migrations.
* Seed script.
* UUID primary keys.

### Testing

* Backend unit/integration: Vitest/Jest.
* Frontend component/basic flow: Vitest + Testing Library.
* E2E optional: Playwright.
* Lint/typecheck/build bắt buộc.

---

## 4. Domain Model

## 4.1 User

```ts
User {
  id: string
  full_name: string
  email: string
  role: 'BA_MANAGER' | 'PM_PO' | 'BA' | 'ADMIN'
  avatar_url?: string
  created_at: Date
  updated_at: Date
}
```

## 4.2 BA Profile

```ts
BAProfile {
  id: string
  user_id?: string
  full_name: string
  email: string
  phone?: string
  level: 'JUNIOR' | 'MIDDLE' | 'SENIOR' | 'LEAD'
  joined_date: Date
  avatar_url?: string
  status: 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED'
  status_reason?: string
  status_changed_at?: Date
  created_at: Date
  updated_at: Date
  version: number
}
```

Rules:

* Email unique.
* Email immutable sau khi tạo.
* Status mặc định: Active.
* Resigned là terminal state với Manager UI.
* On Leave/Resigned không xuất hiện trong booking dropdown.

## 4.3 Skill Tag

```ts
SkillTag {
  id: string
  name: string
  group: 'DOMAIN' | 'ANALYSIS_SKILL'
  status: 'ACTIVE' | 'RETIRED' | 'PENDING_APPROVAL'
  created_at: Date
  updated_at: Date
}
```

Rules:

* Controlled vocabulary.
* Không cho free-text tag trực tiếp.
* PM/PO filter dùng AND logic khi chọn nhiều tag.

## 4.4 BA Skill Mapping

```ts
BASkillTag {
  id: string
  ba_id: string
  tag_id: string
  assigned_by: string
  assigned_at: Date
}
```

## 4.5 Project

```ts
Project {
  id: string
  name: string
  color: string
  description?: string
  created_at: Date
  updated_at: Date
}
```

## 4.6 Booking

```ts
Booking {
  id: string
  ba_id: string
  project_id: string
  requester_id: string
  manager_id?: string

  title: string
  description: string
  start_date: Date
  end_date: Date
  capacity_percent: 50 | 100
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

  reject_reason?: string
  cancel_reason?: string
  manager_comment?: string

  approved_at?: Date
  rejected_at?: Date
  cancelled_at?: Date

  created_at: Date
  updated_at: Date
}
```

Rules:

* `end_date` phải >= `start_date`.
* Không dùng field giờ.
* PM/PO tạo request → status Pending.
* BA Manager approve → status Approved.
* BA Manager reject → status Rejected, bắt buộc có lý do.
* Approved booking mới là booking chính thức.
* Pending không khóa lịch nhưng phải hiển thị để cảnh báo.
* Approved trong cùng khoảng ngày không được vượt 100% capacity.
* Approved + Pending có thể vượt 100%, nhưng phải cảnh báo overbook.

## 4.7 Private Note

```ts
PrivateNote {
  id: string
  ba_id: string
  content: string
  created_by: string
  created_at: Date
  visibility: 'MANAGER_ONLY'
  masked_at?: Date
  masked_by?: string
  mask_reason?: string
}
```

Rules:

* Append-only.
* Không edit/delete trong UI.
* Max 5000 chars.
* PM/PO và BA không được thấy notes.
* API phải enforce permission, không chỉ hide UI.

## 4.8 Notification

```ts
Notification {
  id: string
  recipient_id: string
  type: string
  title: string
  message: string
  related_entity_type?: string
  related_entity_id?: string
  read_at?: Date
  created_at: Date
}
```

## 4.9 Audit Log

```ts
AuditLog {
  id: string
  actor_id: string
  action: string
  target_type: string
  target_id: string
  old_value?: Json
  new_value?: Json
  result: 'SUCCESS' | 'DENIED' | 'FAILED'
  created_at: Date
}
```

Audit bắt buộc cho:

* Create/update BA.
* Status change.
* Add/remove tag.
* Append note.
* Create/update/cancel booking.
* Approve/reject booking.
* Permission denied attempt.

---

## 5. RBAC

## 5.1 BA Manager

Được phép:

* Xem toàn bộ timeline.
* CRUD booking.
* Approve/reject request.
* Tạo booking trực tiếp.
* Xem reports.
* Export CSV.
* CRUD BA profile, ngoại trừ restore Resigned.
* Gắn/gỡ skill/domain tags.
* Xem/append private notes.
* Xem booking history và utilization tất cả BA.

## 5.2 PM/PO

Được phép:

* Xem timeline read-only.
* Tạo booking request.
* Xem My Requests.
* Sửa và gửi lại request bị rejected.
* Xem public BA card.
* Filter BA theo skill/domain.
* Chỉ thấy BA Active.

Không được:

* Approve/reject.
* Sửa booking của người khác.
* Xem private notes.
* Xem full CRM profile riêng tư.
* Xem BA On Leave/Resigned trong booking dropdown.

## 5.3 BA

Được phép:

* Xem My Schedule.
* Xem booking được assign.
* Xem profile của chính mình ở chế độ read-only nếu triển khai.
* Không được tạo booking.
* Không được xem notes.

## 5.4 Admin

Được phép:

* Quyền đặc biệt cho taxonomy.
* Restore Resigned nếu cần.
* Mask/redact notes nếu cần.

---

## 6. Core Business Rules

## 6.1 Date Range Booking

Booking là date-range.

Ví dụ hợp lệ:

```ts
start_date = 2026-06-04
end_date = 2026-06-10
capacity_percent = 50
```

Không có khái niệm 9h-10h.

Timeline chia theo ngày trong week/month view.

## 6.2 Capacity Calculation

Trong một khoảng ngày, với từng BA:

```ts
approved_capacity = sum(capacity_percent của booking Approved/In Progress overlap ngày đó)
pending_capacity = sum(capacity_percent của booking Pending overlap ngày đó)
risk_capacity = approved_capacity + pending_capacity
```

Rules:

* Nếu `approved_capacity > 100`: không cho approve.
* Nếu `risk_capacity > 100`: hiển thị cảnh báo overbook.
* Pending không khóa slot chính thức.
* Manager quyết định approve/reject cuối cùng.

## 6.3 Overlap Logic

Hai booking overlap nếu:

```ts
bookingA.start_date <= bookingB.end_date
AND
bookingA.end_date >= bookingB.start_date
```

## 6.4 Utilization

Công thức CRM:

```ts
Utilization% = booked_days / (working_days_in_month - leave_days) * 100
```

Trong MVP nếu chưa có leave module:

* `leave_days = 0`, trừ khi BA status On Leave có date range được thêm sau.
* Working days loại weekend.
* Public holiday có thể để TODO/deferred nếu chưa có holiday source.

## 6.5 Status Gating

* Active: có thể book.
* On Leave: không hiện trong booking dropdown.
* Resigned: không hiện trong booking dropdown, giữ lịch sử booking cũ.
* Resigned không hard delete.

---

## 7. UI / UX Blueprint

## 7.1 Navigation

Các màn hình chính:

1. BA Calendar / Resource Timeline
2. My Schedule
3. My Requests
4. Manager Inbox
5. BA Directory / CRM
6. BA Profile
7. Reports
8. Notifications

Hiển thị theo role.

## 7.2 Resource Timeline

Layout giống ảnh mẫu:

* Cột trái: BA avatar, tên, level, current capacity.
* Phần chính: timeline theo ngày.
* Header: filter BA, filter Project, view mode Week/Month, Today, next/prev.
* Booking bar:

  * Approved: màu đặc.
  * Pending: viền nét đứt / nền vàng nhạt.
  * Available: pattern nhạt.
* Capacity label trên từng BA.
* Click ô trống tạo request.
* Click booking bar xem detail drawer/modal.
* Có summary panel bên phải:

  * Average capacity.
  * Count BA rảnh / đang có việc / gần full / overbook.
  * Legend.
  * Capacity rules.

## 7.3 Create Booking Request Modal

Fields:

* BA cần đặt.
* Project/task name.
* Start date.
* End date.
* Capacity: 50% / 100%.
* Priority: Low / Medium / High / Urgent.
* Description.
* Notes/link context optional.

Validation:

* BA required.
* Project required.
* Start date required.
* End date required.
* End date >= start date.
* Description required.
* Capacity chỉ 50 hoặc 100.
* Nếu BA có conflict/risk thì show warning nhưng vẫn cho submit Pending.

## 7.4 Manager Inbox

Hiển thị danh sách Pending requests.

Mỗi request có:

* BA.
* Project.
* Date range.
* Capacity.
* Priority.
* Requester.
* Conflict/capacity warning nếu có.
* Button Approve.
* Button Reject.
* Button View details.

Reject bắt buộc nhập reason.

Approve phải check lại capacity tại thời điểm approve.

## 7.5 My Requests

Dành cho PM/PO.

Hiển thị:

* Request đã gửi.
* Status.
* Reject reason nếu bị từ chối.
* Nút Edit & Resubmit cho Rejected request.
* Filter theo status/date/project.

## 7.6 My Schedule

Dành cho BA.

Hiển thị:

* Approved/In Progress/Completed bookings của chính BA.
* Calendar hoặc list view.
* Click booking xem project detail, description, PM/PO requester.

## 7.7 BA Directory / CRM

Dành cho BA Manager, Admin và một phần PM/PO.

Manager view:

* Search BA.
* Filter level/status/skill/domain.
* List/card/table BA.
* Create BA.
* Edit BA.
* View profile.
* Status badge.
* Top tags.
* Current utilization/capacity.

PM/PO view:

* Chỉ BA Active.
* Public info only.
* Không notes.
* Không phone/email nếu policy không cho.

## 7.8 BA Profile

Sections:

* Basic info.
* Status.
* Skill/domain tags.
* Current bookings.
* Booking history.
* Utilization stats.
* Private notes: Manager only.
* Audit/activity summary optional.

---

## 8. API Blueprint

Base path đề xuất:

```txt
/api
```

## 8.1 Auth / Me

```http
GET /api/me
```

Returns current user and role.

## 8.2 BA CRM

```http
GET    /api/ba
POST   /api/ba
GET    /api/ba/:id
PATCH  /api/ba/:id
PATCH  /api/ba/:id/status
GET    /api/ba/:id/public-card
GET    /api/ba/:id/booking-history
GET    /api/ba/:id/utilization
```

## 8.3 Tags

```http
GET    /api/tags
POST   /api/ba/:id/tags
DELETE /api/ba/:id/tags/:tagId
```

## 8.4 Notes

```http
GET  /api/ba/:id/notes
POST /api/ba/:id/notes
```

Only Manager/Admin/Legal.

## 8.5 Projects

```http
GET  /api/projects
POST /api/projects
```

## 8.6 Bookings

```http
GET    /api/bookings
POST   /api/bookings/request
POST   /api/bookings/direct
GET    /api/bookings/:id
PATCH  /api/bookings/:id
POST   /api/bookings/:id/approve
POST   /api/bookings/:id/reject
POST   /api/bookings/:id/cancel
GET    /api/bookings/my-requests
GET    /api/bookings/my-schedule
```

## 8.7 Capacity

```http
GET /api/capacity/summary
GET /api/capacity/ba/:baId
GET /api/capacity/range-check
```

## 8.8 Reports

```http
GET /api/reports/utilization
GET /api/reports/utilization.csv
```

## 8.9 Notifications

```http
GET  /api/notifications
POST /api/notifications/:id/read
```

---

## 9. Frontend File Structure đề xuất

Nếu repo mới:

```txt
src/
  app/
    router.tsx
    providers.tsx
  pages/
    DashboardPage.tsx
    TimelinePage.tsx
    MySchedulePage.tsx
    MyRequestsPage.tsx
    ManagerInboxPage.tsx
    BADirectoryPage.tsx
    BAProfilePage.tsx
    ReportsPage.tsx
  features/
    auth/
    ba/
      components/
      hooks/
      api.ts
      types.ts
    bookings/
      components/
      hooks/
      api.ts
      types.ts
    timeline/
      components/
      utils/
      types.ts
    capacity/
      components/
      utils/
    notifications/
    reports/
  components/
    ui/
    layout/
    common/
  lib/
    apiClient.ts
    date.ts
    rbac.ts
    format.ts
  styles/
    globals.css
```

---

## 10. Backend File Structure đề xuất

Nếu repo mới:

```txt
backend/
  prisma/
    schema.prisma
    seed.ts
  src/
    main.ts
    app.module.ts
    common/
      guards/
      decorators/
      filters/
      pipes/
    auth/
    users/
    ba/
    tags/
    bookings/
    capacity/
    projects/
    notes/
    notifications/
    reports/
    audit/
  test/
```

Nếu mono-repo:

```txt
apps/
  web/
  api/
packages/
  shared/
```

---

# 11. TASK GRAPH

```txt
TIP-000: Scan codebase
    └── TIP-001: Scaffold / stabilize project foundation
            └── TIP-002: Database schema + Prisma migrations
                    └── TIP-003: Seed data
                            ├── TIP-004: Auth mock + RBAC
                            ├── TIP-005: BA CRM APIs
                            │       ├── TIP-006: Skill tags + BA profile UI
                            │       └── TIP-007: Private notes + audit log
                            ├── TIP-008: Booking APIs + capacity engine
                            │       ├── TIP-009: Booking request UI
                            │       ├── TIP-010: Manager approval inbox
                            │       └── TIP-011: Resource timeline UI
                            ├── TIP-012: My Requests + My Schedule
                            ├── TIP-013: Reports + utilization export
                            ├── TIP-014: Notifications
                            └── TIP-015: QA / Verify / hardening
```

---

# 12. TASK INSTRUCTION PACKS

---

# TIP-000: Scan Codebase

## Header

* TIP-ID: TIP-000
* Project: BA Bazaar / BA Booking + CRM
* Module: Scan
* Depends on: None
* Priority: P0
* Estimated effort: 30-60 minutes

## Context

You must inspect the existing repo before changing anything.

## Task

Scan the codebase and produce a Scan Report.

## Specifications

Inspect:

1. Folder structure max 3 levels.
2. Manifests: package.json, pnpm-lock, tsconfig, vite config, prisma, etc.
3. Existing frontend/backend modules.
4. Existing routing.
5. Existing API patterns.
6. Existing DB patterns.
7. Existing auth/RBAC.
8. Existing styling/component system.
9. Existing test scripts.
10. Existing env files.
11. Gaps and risks.

## Acceptance Criteria

Given the repo exists
When you complete scan
Then you return a Scan Report with stack, structure, entry points, patterns, tests, gaps and risks.

## Constraints

* Do not edit code.
* Do not install dependencies.
* Do not redesign.

## Required Tests

No tests required.

## Report Format

Return:

```md
# SCAN REPORT: BA Bazaar

## Scope
## Tech Stack
## Structure
## Existing Modules
## Entry Points
## Patterns Detected
## Reusable Components / Utilities
## Environment
## Tests & Scripts
## Code Health
## Gaps Detected
## Estimated Size
```

---

# TIP-001: Scaffold / Stabilize Project Foundation

## Header

* TIP-ID: TIP-001
* Project: BA Bazaar / BA Booking + CRM
* Module: Foundation
* Depends on: TIP-000
* Priority: P0
* Estimated effort: 1-2 sessions

## Task

Set up or stabilize the base project structure.

## Specifications

If project is empty:

* Create fullstack TypeScript project.
* Frontend: React + Vite + TypeScript + Tailwind.
* Backend: Node TypeScript API.
* Database: PostgreSQL + Prisma.
* Add lint/typecheck/build scripts.
* Add `.env.example`.
* Add README quick start.

If project already exists:

* Reuse existing stack.
* Add missing folders only where needed.
* Do not rewrite unrelated code.

## Acceptance Criteria

Given a fresh clone
When developer follows README
Then frontend and backend can run locally.

Given `npm run build` or equivalent
When executed
Then app builds without TypeScript errors.

Given `.env.example`
When read
Then required environment variables are documented.

## Constraints

* Do not add unrelated UI pages.
* Do not add hourly booking model.
* Do not choose a different stack if repo already has one.

## Required Tests

Run:

```bash
npm run typecheck
npm run lint
npm run build
```

If scripts differ, run equivalent commands and report them.

---

# TIP-002: Database Schema + Migrations

## Header

* TIP-ID: TIP-002
* Module: Database
* Depends on: TIP-001
* Priority: P0

## Task

Implement PostgreSQL schema for BA Bazaar + CRM.

## Specifications

Create models for:

* User
* BAProfile
* SkillTag
* BASkillTag
* Project
* Booking
* PrivateNote
* Notification
* AuditLog

Important:

* Booking uses `start_date` and `end_date`.
* No time/hour fields.
* Add indexes for:

  * booking ba_id
  * booking status
  * booking date range
  * BA status
  * tag group/status
  * audit target
* Use enums for role, BA status, booking status, priority, tag group.

## Acceptance Criteria

Given database migration runs
When completed
Then all required tables exist.

Given Booking model
When inspected
Then it contains `start_date`, `end_date`, `capacity_percent` and no hourly fields.

Given BAProfile model
When inspected
Then email is unique and status enum exists.

## Constraints

* Do not use SQLite for final DB unless repo is prototype-only and explicitly configured.
* Do not add recurring booking.
* Do not add Google Calendar integration.

## Required Tests

Run:

```bash
npx prisma validate
npx prisma migrate dev
```

Or equivalent.

---

# TIP-003: Seed Data

## Header

* TIP-ID: TIP-003
* Module: Seed
* Depends on: TIP-002
* Priority: P0

## Task

Create realistic seed data.

## Specifications

Seed:

* 1 BA Manager.
* 5 PM/PO.
* 15 BA.
* At least 8 skill/domain tags.
* At least 5 projects.
* At least 20 bookings across statuses.
* At least 5 private notes.
* Notifications sample.

BA data must include:

* full name
* email
* phone
* level
* joined date
* avatar url or initials fallback
* status
* skill/domain tags

Bookings must include date ranges and capacity 50/100.

Include examples:

* BA with 0% current capacity.
* BA with 30-40%.
* BA with 50-60%.
* BA with 90-100%.
* BA with pending request causing overbook risk.
* BA On Leave.
* BA Resigned with historical booking.

## Acceptance Criteria

Given seed command runs
When database is inspected
Then there are 15 BA, 5 PM/PO, 1 BA Manager.

Given timeline page loads
When using seed data
Then it shows multiple bookings across different statuses.

Given CRM page loads
When using seed data
Then BA profiles have tags and realistic details.

## Required Tests

Run seed command and verify counts.

---

# TIP-004: Auth Mock + RBAC

## Header

* TIP-ID: TIP-004
* Module: Auth/RBAC
* Depends on: TIP-003
* Priority: P0

## Task

Implement local/internal auth and role-based authorization.

## Specifications

For MVP/dev:

* Add role switcher or mock login page if no real auth exists.
* Roles:

  * BA_MANAGER
  * PM_PO
  * BA
  * ADMIN

Backend must enforce permissions.

Do not rely only on frontend hiding.

Implement guards/middleware for:

* Booking create.
* Booking approve/reject.
* BA profile create/update.
* Notes read/write.
* Reports export.
* Public card access.

## Acceptance Criteria

Given PM/PO calls approve API
When request is sent
Then API returns 403.

Given BA calls private notes API
When request is sent
Then API returns 403.

Given BA Manager calls notes API
When request is sent
Then API returns 200.

Given PM/PO opens booking form
When selecting BA
Then only Active BA appear.

## Required Tests

Add API permission tests for at least:

* PM/PO cannot approve.
* PM/PO cannot read notes.
* BA cannot create booking.
* Manager can approve/reject.

---

# TIP-005: BA CRM APIs

## Header

* TIP-ID: TIP-005
* Module: CRM API
* Depends on: TIP-004
* Priority: P0

## Task

Implement APIs for BA Directory and BA Profile.

## Specifications

Endpoints:

```http
GET    /api/ba
POST   /api/ba
GET    /api/ba/:id
PATCH  /api/ba/:id
PATCH  /api/ba/:id/status
GET    /api/ba/:id/public-card
GET    /api/ba/:id/booking-history
GET    /api/ba/:id/utilization
```

Rules:

* Search by name.
* Filter by status, level, tag.
* PM/PO only sees Active/public data.
* BA only sees self profile if applicable.
* Manager sees full CRM data.
* Email immutable.
* Resigned profile read-only for Manager UI update.
* Status change must audit log.
* On Leave/Resigned excluded from booking dropdown.

## Acceptance Criteria

Given Manager creates BA with unique email
When submitted
Then BA is created as Active.

Given duplicate email
When submitted
Then API returns validation error.

Given Manager tries to update email
When submitted
Then API rejects or ignores email update with clear error.

Given PM/PO lists BA
When data contains Active, On Leave, Resigned
Then only Active BA are returned.

## Required Tests

* Create BA.
* Duplicate email.
* Update BA.
* Status change.
* Public card permission filtering.

---

# TIP-006: BA Directory + BA Profile UI

## Header

* TIP-ID: TIP-006
* Module: CRM UI
* Depends on: TIP-005
* Priority: P0

## Task

Build BA Directory and BA Profile UI.

## Specifications

BA Directory:

* Search input.
* Filter by level/status/tag.
* Table or cards.
* Avatar, name, level, status, current utilization/capacity, top tags.
* Create BA button for Manager.
* PM/PO view only Active BA.

BA Profile:

* Basic info.
* Skill/domain tags.
* Status controls for Manager.
* Booking history.
* Utilization.
* Notes section only Manager.
* Public info only for PM/PO.

## Acceptance Criteria

Given Manager opens BA Directory
Then all BA statuses can be viewed/filterable.

Given PM/PO opens BA Directory
Then only Active BA are visible.

Given Manager opens BA Profile
Then notes section is visible.

Given PM/PO opens BA Profile/public card
Then notes and private fields are hidden.

## Required Tests

Manual role-based UI checks.

---

# TIP-007: Skill Tags + Private Notes + Audit Log

## Header

* TIP-ID: TIP-007
* Module: CRM Governance
* Depends on: TIP-006
* Priority: P1

## Task

Implement skill/domain tag management, private notes, and audit logging.

## Specifications

Tags:

* Controlled vocabulary.
* Manager can assign/remove existing tags.
* No free-text direct creation by PM/PO.
* Multi-tag booking filter uses AND logic.

Notes:

* Append-only.
* Max 5000 chars.
* Manager only.
* No edit/delete buttons.
* API-level permission.

Audit:

* Log mutations.
* Log denied permission attempts where practical.
* Avoid storing raw note content in old/new values if possible.

## Acceptance Criteria

Given Manager adds tag to BA
Then tag appears in profile and filter.

Given Manager removes tag
Then BA no longer matches that tag filter.

Given Manager appends note
Then note appears with author and timestamp.

Given PM/PO calls notes API
Then API returns 403.

Given mutation occurs
Then audit log record is created.

## Required Tests

API tests + manual UI checks.

---

# TIP-008: Booking APIs + Capacity Engine

## Header

* TIP-ID: TIP-008
* Module: Booking API
* Depends on: TIP-004, TIP-005
* Priority: P0

## Task

Implement booking request APIs and capacity engine.

## Specifications

Endpoints:

```http
GET    /api/bookings
POST   /api/bookings/request
POST   /api/bookings/direct
GET    /api/bookings/:id
PATCH  /api/bookings/:id
POST   /api/bookings/:id/approve
POST   /api/bookings/:id/reject
POST   /api/bookings/:id/cancel
GET    /api/bookings/my-requests
GET    /api/bookings/my-schedule
```

Capacity:

* Use date overlap logic.
* Approved/In Progress count as official capacity.
* Pending counts as risk capacity.
* Cannot approve if approved capacity would exceed 100.
* Can submit Pending even if risk capacity exceeds 100, but response must include warning.
* BA On Leave/Resigned cannot be booked.

Status:

* PM/PO request -> Pending.
* Manager direct booking -> Approved.
* Approve -> Approved.
* Reject -> Rejected, reason required.
* Cancel -> Cancelled, reason required.

## Acceptance Criteria

Given PM/PO submits valid request
Then booking is created with Pending.

Given BA already has Approved 100% overlap
When PM/PO submits another request
Then booking can be Pending but response includes overbook warning.

Given Manager approves request that would exceed Approved 100%
Then API blocks approve with clear error.

Given Manager rejects request without reason
Then API returns validation error.

Given Manager creates direct booking
Then booking status is Approved.

## Required Tests

* Date overlap.
* Capacity sum.
* Pending risk warning.
* Approve block.
* Reject reason required.
* Status permission.

---

# TIP-009: Booking Request UI

## Header

* TIP-ID: TIP-009
* Module: Booking UI
* Depends on: TIP-008
* Priority: P0

## Task

Build create booking request flow for PM/PO.

## Specifications

User can open form from:

* Timeline empty slot.
* Create Request button.

Form fields:

* BA
* Project/task
* Start date
* End date
* Capacity 50/100
* Priority
* Description
* Notes/context optional

UX:

* Show selected BA public card.
* Show skill/domain tags.
* Show capacity warning before submit if detected.
* Submit success toast.
* Request goes to Pending.

## Acceptance Criteria

Given PM/PO clicks empty timeline slot
Then form opens with BA/date prefilled if available.

Given required fields missing
Then inline validation appears.

Given valid form submitted
Then Pending request is created and visible in My Requests.

Given conflict risk exists
Then warning appears but submit is allowed.

## Required Tests

Manual end-to-end flow.

---

# TIP-010: Manager Approval Inbox

## Header

* TIP-ID: TIP-010
* Module: Approval
* Depends on: TIP-008
* Priority: P0

## Task

Build Manager Inbox for pending booking requests.

## Specifications

Inbox shows:

* Pending requests.
* BA info.
* Project.
* Requester.
* Date range.
* Capacity.
* Priority.
* Description.
* Capacity risk warning.
* Approve button.
* Reject button.
* View detail.

Approve:

* Calls approve API.
* Re-checks capacity.
* Updates timeline.

Reject:

* Opens reason modal.
* Reason required.
* PM/PO sees reason in My Requests.

## Acceptance Criteria

Given Manager opens Inbox
Then pending requests are listed.

Given Manager approves valid request
Then status becomes Approved and appears as official booking on timeline.

Given Manager approves over-capacity request
Then system blocks and explains reason.

Given Manager rejects with reason
Then status becomes Rejected and reason is visible to requester.

## Required Tests

Manual role-based checks.

---

# TIP-011: Resource Timeline UI

## Header

* TIP-ID: TIP-011
* Module: Timeline
* Depends on: TIP-008, TIP-009, TIP-010
* Priority: P0

## Task

Build Gantt-style Resource Timeline.

## Specifications

Timeline must show:

* BA list vertically.
* Date columns horizontally.
* Week and Month modes.
* Today button.
* Prev/Next navigation.
* Filters:

  * BA
  * Project
  * Status
* Booking bars:

  * Approved/In Progress: solid.
  * Pending: dashed/outlined.
  * Available: light patterned cells.
* Capacity percentage per BA.
* Right-side capacity summary.
* Legend.
* Click empty slot opens booking request.
* Click booking opens detail.

## Acceptance Criteria

Given seed data
When Timeline opens
Then BA rows and booking bars render correctly.

Given user switches Week/Month
Then date columns update.

Given PM/PO clicks empty slot
Then create request modal opens.

Given Manager clicks Pending booking
Then detail includes approve/reject action or link to Inbox.

Given BA has pending + approved over 100 risk
Then warning is visible.

## Required Tests

Manual visual checks across:

* Desktop 1366x768.
* Desktop 1920x1080.
* Tablet 768x1024.
* Mobile 390x844 with usable fallback layout.

---

# TIP-012: My Requests + My Schedule

## Header

* TIP-ID: TIP-012
* Module: Role Dashboards
* Depends on: TIP-008
* Priority: P1

## Task

Build PM/PO My Requests and BA My Schedule.

## Specifications

My Requests:

* List requests created by current PM/PO.
* Filter by status.
* Show reject reason.
* Rejected request has Edit & Resubmit.
* Status badges.

My Schedule:

* For BA.
* Show assigned Approved/In Progress/Completed bookings.
* Calendar/list view.
* Booking detail modal.

## Acceptance Criteria

Given PM/PO has requests
Then My Requests shows them with correct status.

Given request is Rejected
Then reject reason is visible.

Given BA opens My Schedule
Then only own assigned bookings are visible.

Given BA tries to view another BA private booking endpoint
Then API denies if not allowed.

## Required Tests

Manual role-based checks.

---

# TIP-013: Reports + Utilization Export

## Header

* TIP-ID: TIP-013
* Module: Reports
* Depends on: TIP-008
* Priority: P1

## Task

Implement utilization reports and CSV export.

## Specifications

Reports page for Manager:

* Filter by month/quarter.
* Show BA utilization table.
* Show total booked days.
* Show average utilization.
* Show project count.
* Export CSV.

CSV fields:

* BA name.
* Level.
* Project.
* Start date.
* End date.
* Capacity percent.
* Status.
* Requester.
* Utilization period.

## Acceptance Criteria

Given Manager opens Reports
Then utilization data is shown.

Given Manager clicks Export CSV
Then CSV downloads with required columns.

Given PM/PO tries reports endpoint
Then API returns 403.

## Required Tests

* Export CSV.
* Permission test.
* Utilization calculation sanity check.

---

# TIP-014: Notifications

## Header

* TIP-ID: TIP-014
* Module: Notifications
* Depends on: TIP-008, TIP-010
* Priority: P2

## Task

Implement in-app notifications.

## Specifications

Events:

* PM/PO creates booking request -> BA Manager notified.
* Booking approved -> PM/PO and assigned BA notified.
* Booking rejected -> PM/PO notified.
* Booking cancelled -> PM/PO and BA notified.
* Optional reminders can be deferred.

UI:

* Notification bell.
* Unread count.
* Notification dropdown/list.
* Mark as read.

## Acceptance Criteria

Given PM/PO creates request
Then Manager receives notification.

Given Manager approves request
Then PM/PO and BA receive notification.

Given user marks notification as read
Then unread count decreases.

## Required Tests

Manual and API tests where practical.

---

# TIP-015: QA / Verify / Hardening

## Header

* TIP-ID: TIP-015
* Module: QA
* Depends on: All previous TIPs
* Priority: P0

## Task

Run full QA against requirements.

## Required QA Scope

Tier 1:

* App starts.
* Build succeeds.
* Main booking flow works.
* Main CRM flow works.
* Role permissions work.
* No placeholder UI in shipped paths.
* No console/runtime errors in main flows.

Tier 2:

* Empty states.
* Invalid form inputs.
* Boundary date values.
* Overbook warning.
* Approve block.
* Responsive layout.
* Network/API failure state.

Tier 3:

* No secrets in frontend.
* API-level RBAC enforced.
* Audit logs generated.
* Basic accessibility checks.
* Performance acceptable for seed data.

## Required End-to-End Scenarios

### Scenario 1: PM/PO creates request

Given PM/PO logs in
When PM/PO opens timeline and creates request for Active BA
Then request is created as Pending
And appears in My Requests
And Manager receives notification.

### Scenario 2: Manager approves request

Given Pending request exists
When Manager approves it
Then status becomes Approved
And booking appears as solid bar on timeline
And PM/PO + BA receive notification.

### Scenario 3: Manager rejects request

Given Pending request exists
When Manager rejects with reason
Then status becomes Rejected
And PM/PO sees reason
And request can be edited/resubmitted if implemented.

### Scenario 4: Overbook risk

Given BA has Approved 50% in date range
And PM/PO creates Pending 100% in overlapping date range
Then system allows submit but shows risk warning.

### Scenario 5: Approve blocked

Given BA already has Approved 100% in date range
When Manager approves another overlapping 50% request
Then system blocks approve.

### Scenario 6: CRM status gating

Given BA status is On Leave
When PM/PO opens booking dropdown
Then BA is not visible.

### Scenario 7: Notes privacy

Given Manager adds private note
When PM/PO or BA opens BA profile/public card
Then note is not visible
And notes API returns 403.

### Scenario 8: Skill filter AND logic

Given BA A has Fintech
And BA B has Fintech + BPMN
When PM/PO filters Fintech + BPMN
Then only BA B appears.

## Required Commands

Run available equivalents:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

If e2e exists:

```bash
npm run test:e2e
```

## Output

Return QA Report:

```md
# QA REPORT: BA Bazaar

Date:
Environment:
Version/branch:

## Summary

| Tier | Passed | Failed | Partial | Skipped | Status |
|---|---:|---:|---:|---:|---|

## Test Results

| ID | Requirement / AC | Test | Result | Evidence |
|---|---|---|---|---|

## Issues

| Severity | Issue | Affected REQ/TIP | Evidence | Recommendation |
|---|---|---|---|---|

## Overall Status

APPROVED / NEEDS WORK / BLOCKED
```

---

# 13. Definition of Done

Project is done only when:

* Booking date-range flow works end-to-end.
* No hourly booking fields exist.
* PM/PO can create request.
* Manager can approve/reject.
* Timeline shows booking status correctly.
* Capacity engine prevents approved capacity > 100.
* Pending overbook risk is visible.
* BA Manager can manage BA profiles.
* Skill/domain tags work.
* PM/PO can filter Active BA by tags.
* On Leave/Resigned BA cannot be booked.
* Private notes are Manager-only.
* Booking history and utilization are visible.
* CSV export works.
* Notifications work at least in-app.
* RBAC is enforced at API layer.
* Audit log records key mutations.
* Seed data exists and is realistic.
* Build/typecheck/lint pass.
* QA Report has no P0/P1 unresolved issues.

---

# 14. Completion Report Required After Every TIP

After each TIP, return:

```md
## COMPLETION REPORT — TIP-[XXX]

**STATUS:** DONE / PARTIAL / BLOCKED

**FILES CHANGED:**
- Created:
- Modified:
- Deleted:

**IMPLEMENTATION SUMMARY:**
- ...

**TEST RESULTS:**
- Acceptance criteria: X/Y passed
- Commands run:
- Manual checks:

**ISSUES DISCOVERED:**
- [severity] — [description] — [recommendation]

**DEVIATIONS FROM SPEC:**
- [what] — [why] — [impact]

**SUGGESTIONS FOR CONTRACTOR:**
- ...
```

---

# 15. Escalation Rules

Codex must escalate instead of guessing when:

* Existing repo stack conflicts with proposed stack.
* Current schema already has hourly booking fields.
* PRD conflicts with CRM rules.
* RBAC cannot be enforced cleanly.
* Date/capacity calculation has ambiguous cases.
* Existing UI architecture cannot support timeline.
* Tests cannot run due missing env/dependencies.
* Any TIP requires dependency not approved.

Escalation format:

```md
# ESCALATION REPORT

TIP:
Issue:
Category:

## Evidence
- ...

## Options
A. ...
B. ...

## Builder Recommendation
...

Need Contractor/Homeowner decision.
```

---

# 16. Absolute Constraints

1. Do not implement hourly booking.
2. Do not replace date-range model with datetime model.
3. Do not remove approval workflow.
4. Do not allow PM/PO to approve/reject.
5. Do not expose private notes to PM/PO or BA.
6. Do not hard delete BA in Manager UI.
7. Do not allow booking On Leave/Resigned BA.
8. Do not silently exceed Approved capacity 100%.
9. Do not add external calendar integration.
10. Do not add AI matching.
11. Do not skip seed data.
12. Do not skip QA report.

---

# 17. First Command for Codex

Start with TIP-000 only.

Do not implement anything until Scan Report is returned.

```md
# Vibecode Builder Mode

You are the Builder for BA Bazaar / BA Booking + CRM.

Rules:
1. Follow the TIP exactly.
2. Do not change architecture unless instructed.
3. Do not add out-of-scope features.
4. Do not change dependencies unless instructed.
5. Self-test acceptance criteria.
6. Report DONE / PARTIAL / BLOCKED.
7. Escalate ambiguity instead of guessing.

Your first task is TIP-000: Scan Codebase.

Return only the Scan Report.
```
