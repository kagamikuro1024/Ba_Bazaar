# KẾ HOẠCH THI CÔNG SỬA UI/UX THEO ROLE

# BA Bazaar / BA Booking CRM — UI Fix Batch 03

## 0. Mục tiêu chung

Sửa các lỗi UI/UX mới phát hiện sau review theo từng role:

* BA phải thấy đúng lịch công việc hiện tại và tương lai.
* PM/PO phải quản lý request gọn hơn, dễ sửa request hơn.
* BA Manager phải có dashboard/action center/timeline rõ ràng hơn, giảm nhiễu thông tin.
* Timeline cần dễ đọc hơn, đặc biệt ở week/quarter view.
* BA Directory cần thao tác create BA bằng popup hoàn chỉnh.

Không thay đổi business rule booking:

```ts
start_date
end_date
capacity_percent
```

Không thêm booking theo giờ.

---

# PHẦN A — ROLE BA: Sửa Timeline / Upcoming Work / My Schedule

## A1. Vấn đề

Với role BA hiện tại:

* BA bị mất Timeline.
* Khi bấm `Upcoming Work` thì đi tới `My Schedule`.
* `My Schedule` hiện chỉ thấy `Completed`, đây là sai.
* Đúng ra `Upcoming Work` phải hiển thị các task tương lai được assign sau task hiện tại.

## A2. Điều hướng BA cần có

Navigation của BA nên có tối thiểu:

```txt
My Schedule
Timeline
My Tasks / Upcoming Work
```

Nếu muốn gọn hơn:

```txt
My Schedule
Timeline
```

Trong đó `Upcoming Work` ở dashboard có thể link tới:

```txt
/my-schedule?tab=upcoming
```

hoặc:

```txt
/my-schedule?filter=upcoming
```

## A3. My Schedule phải hiển thị thông tin gì?

`My Schedule` của BA cần có 3 nhóm chính:

### 1. Current Work

Booking/task đang diễn ra hiện tại.

Điều kiện:

```txt
start_date <= today <= end_date
status = APPROVED hoặc IN_PROGRESS
```

Hiển thị:

* Project/task name.
* Date range.
* Capacity %.
* PM/PO requester.
* Description/scope.
* Status.
* Days remaining.
* Link/detail button.

### 2. Upcoming Work

Các booking/task tương lai đã được assign.

Điều kiện:

```txt
start_date > today
status = APPROVED
```

Sort:

```txt
start_date ASC
```

Hiển thị:

* Project/task name.
* Start date.
* End date.
* Capacity %.
* PM/PO requester.
* Priority nếu có.
* Description/scope.
* Preparation note nếu có.

### 3. Completed Work

Các booking/task đã hoàn thành.

Điều kiện:

```txt
end_date < today
hoặc status = COMPLETED
```

Sort:

```txt
end_date DESC
```

Hiển thị:

* Project/task name.
* Date range.
* Capacity.
* Status Completed.
* PM/PO requester.

## A4. UI đề xuất My Schedule

Dùng tab:

```txt
Current | Upcoming | Completed | All
```

Default khi BA vào `My Schedule`:

```txt
Current nếu có task hiện tại
nếu không có Current thì Upcoming
nếu không có cả hai thì Empty State
```

Khi click `Upcoming Work` từ dashboard:

```txt
Open My Schedule với tab Upcoming
```

## A5. Acceptance Criteria

* [ ] BA thấy lại Timeline nếu role BA được phép xem team timeline/read-only.
* [ ] BA click `Upcoming Work` mở đúng tab Upcoming.
* [ ] My Schedule không chỉ hiển thị Completed.
* [ ] Current Work hiển thị task đang chạy.
* [ ] Upcoming Work hiển thị task tương lai.
* [ ] Completed Work hiển thị task đã xong.
* [ ] BA không được edit/approve/reject booking.
* [ ] BA không thấy private notes.
* [ ] Empty state rõ ràng nếu không có task.

---

# PHẦN B — ROLE PM/PO: My Requests, Edit Request, Dashboard CTA

## B1. Vấn đề

Với role PM/PO:

* Trang My Requests đang hiển thị 1 card/1 hàng, quá dài, nhiều khoảng trống.
* Edit request nên chuyển thành popup/modal.
* Dashboard không nên có nút Create Request.

## B2. My Requests layout mới

Đổi layout từ 1 card/1 hàng sang grid:

```txt
Desktop: 3 cards / row
Tablet: 2 cards / row
Mobile: 1 card / row
```

Tailwind gợi ý:

```tsx
<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
```

## B3. Card My Requests cần gọn lại

Mỗi request card chỉ nên hiển thị:

* Project/task name.
* Status badge.
* Priority badge.
* Date range.
* Requested BA / Assigned BA / Unassigned.
* Capacity %.
* Main action:

  * View Detail.
  * Edit nếu Pending/Rejected.
  * Resubmit nếu Rejected.

Không để card quá cao hoặc quá nhiều khoảng trắng.

## B4. Edit My Request bằng popup

Hiện tại nếu edit chuyển trang hoặc làm flow dài thì đổi thành modal/popup.

Behavior:

* Click `Edit`.
* Mở modal `Edit Request`.
* Prefill dữ liệu cũ.
* Cho sửa:

  * Project/task name.
  * Date range.
  * Capacity.
  * Priority.
  * Description.
  * Requested BA nếu request type là Specific BA.
  * Required skills nếu Open Request.
* Submit xong:

  * Modal đóng.
  * Card cập nhật.
  * Toast success.

Rule:

* Chỉ edit được request `PENDING` hoặc `REJECTED`.
* Không cho edit request đã `APPROVED`.
* Nếu request `REJECTED`, submit lại thì status về `PENDING` hoặc tạo request mới theo logic hiện có.

## B5. Bỏ Create Request ở Dashboard PM/PO

Dashboard PM/PO không cần nút `Create Request` nếu đang gây nhiễu.

CTA tạo request nên đặt ở:

```txt
Timeline
My Requests
BA Directory
BA Profile / BA Card
```

## B6. Acceptance Criteria

* [ ] My Requests desktop hiển thị 3 card mỗi hàng.
* [ ] Tablet hiển thị 2 card mỗi hàng.
* [ ] Mobile hiển thị 1 card mỗi hàng.
* [ ] Card request gọn, không thừa khoảng trắng.
* [ ] Edit request mở bằng modal/popup.
* [ ] Modal prefill đúng data.
* [ ] Submit edit cập nhật request.
* [ ] Không edit được Approved request.
* [ ] Dashboard PM/PO không còn nút Create Request.
* [ ] Create Request vẫn còn ở Timeline/My Requests/BA Directory.

---

# PHẦN C — ROLE BA MANAGER: Dashboard Logic + Action Center Sort

## C1. Vấn đề Dashboard

Dashboard BA Manager hiện có:

* Một số cột/flag không cần thiết.
* Một số flag gần giống nhau, ví dụ `Capacity Risk` và `Overbook`.
* Có flag bị trùng nghĩa.
* Request hiển thị quá nhiều.
* Dashboard nên chỉ hiển thị request cần xử lý nhất.

## C2. Làm sạch flag logic

Chốt lại flag như sau:

### 1. Urgent

Dùng cho request có priority `URGENT`.

```txt
Flag: URGENT
Color: red
```

### 2. High Priority

Dùng cho priority `HIGH`.

```txt
Flag: HIGH
Color: orange/amber
```

### 3. Unassigned

Dùng cho request chưa có BA.

```txt
ba_id = null
status = PENDING
```

### 4. Overbooked

Dùng khi approved/current allocation đã > 100%.

```txt
approved_capacity > 100
```

### 5. Capacity Risk

Dùng khi request pending nếu approve vào sẽ có nguy cơ vượt 100%.

```txt
approved_capacity + pending/request_capacity > 100
```

### Khác biệt quan trọng

```txt
Overbooked = đã vượt thật
Capacity Risk = có nguy cơ vượt nếu approve/assign
```

Không hiển thị cả hai nếu cùng một dòng gây rối. Ưu tiên:

```txt
Overbooked > Capacity Risk
```

## C3. Giảm số lượng request trên Dashboard

Dashboard chỉ hiển thị tối đa:

```txt
5 request/action items
```

Chỉ lấy các request/action quan trọng:

* Priority Urgent.
* Priority High.
* Status Pending.
* Unassigned Pending.
* Capacity Risk.
* Overbooked.

Không hiển thị Approved bình thường trên Dashboard action list.

## C4. Cột trên Dashboard nên giữ

Giữ các cột cần thiết:

```txt
Priority
Project
Requester
Requested/Assigned BA
Date Range
Flag
Action
```

Bỏ bớt:

* Request ID.
* Estimated capacity nếu trùng với Capacity.
* Request Type nếu đã thể hiện bằng Requested/Assigned BA.
* Các metric không dùng để action ngay.

## C5. Action Center sort rule

Action Center cần sort:

```txt
1. Status = PENDING lên trên
2. Priority = URGENT
3. Priority = HIGH
4. Unassigned
5. Capacity Risk
6. Older created date
7. Approved xuống cuối
```

Pseudo logic:

```ts
statusScore:
PENDING = 1000
REJECTED = 300
APPROVED = 100
COMPLETED = 50
CANCELLED = 0

priorityScore:
URGENT = 400
HIGH = 300
MEDIUM = 200
LOW = 100

flagBonus:
UNASSIGNED = 50
CAPACITY_RISK = 40
OVERBOOKED = 60

finalScore = statusScore + priorityScore + flagBonus
sort finalScore DESC, createdAt ASC
```

## C6. Acceptance Criteria

* [ ] Dashboard không còn quá nhiều cột.
* [ ] Flag không trùng nghĩa.
* [ ] Overbooked và Capacity Risk được phân biệt rõ.
* [ ] Dashboard chỉ hiển thị khoảng 5 item quan trọng.
* [ ] Chỉ hiển thị request pending/priority/cần action.
* [ ] Approved bình thường không nằm trên dashboard action list.
* [ ] Action Center sort Pending + Priority lên đầu.
* [ ] Approved bị đẩy xuống cuối.
* [ ] High và Urgent khác màu rõ.

---

# PHẦN D — Timeline: Quarter View, Current Week, Sort BA by Capacity

## D1. Sửa Quarter View

### Vấn đề

Quarter View hiện khó nhìn.

### Yêu cầu

Quarter View cần hiển thị ở mức tổng quan, không cố nhồi chi tiết ngày.

Header:

```txt
Tháng 1 | Tháng 2 | Tháng 3
```

Booking bar:

* Vẫn giữ tỷ lệ vị trí theo ngày trong quý.
* Booking dài hiển thị dài hơn booking ngắn.
* Có tooltip/detail để xem ngày chính xác.
* Overbook vẫn nổi bật.

Nếu quá nhiều task, stack gọn theo hàng.

## D2. Highlight ngày hiện tại

Timeline hiện chưa highlight ngày hiện tại.

Yêu cầu:

* Week View: highlight cột ngày hiện tại.
* Month View: highlight tuần chứa ngày hiện tại.
* Quarter View: highlight tháng chứa ngày hiện tại.

Style:

```txt
background: light blue/yellow subtle
border: accent
label: Today nếu phù hợp
```

Không làm quá chói.

## D3. Week navigation mới

Thay cụm view tuần hiện tại thành dạng:

```txt
[‹] [Tuần 23 · 03/06 - 09/06] [›]
```

Yêu cầu:

* Nút trái lùi 1 tuần.
* Nút phải tiến 1 tuần.
* Label hiển thị week number + date range.
* Nếu đang Month View thì label đổi thành:

```txt
Tháng 06/2026
```

* Nếu Quarter View:

```txt
Q2 · 04/2026 - 06/2026
```

## D4. Sort BA theo capacity khi bấm tên cột BA

Ở timeline có cột BA.

Khi click header `BA`:

Sort cycle:

```txt
Default A-Z
Capacity Desc
Capacity Asc
A-Z
```

Hiển thị icon sort:

```txt
BA ↑
BA ↓
BA
```

Capacity dùng theo timeframe hiện tại:

* Week view: capacity trong tuần.
* Month view: capacity trong tháng.
* Quarter view: capacity trong quý.

## D5. Acceptance Criteria

* [ ] Quarter View dễ nhìn hơn.
* [ ] Quarter header theo tháng.
* [ ] Booking bar giữ tỷ lệ tương quan theo ngày trong quý.
* [ ] Ngày/tuần/tháng hiện tại được highlight.
* [ ] Week navigation hiển thị dạng `[‹] [Tuần 23 · 03/06 - 09/06] [›]`.
* [ ] Month/Quarter label đổi đúng.
* [ ] Click cột BA sort theo capacity.
* [ ] Sort có 3 trạng thái: A-Z / capacity desc / capacity asc.
* [ ] Không phá existing timeline week/month.

---

# PHẦN E — BA Directory: Create BA bằng popup hoàn chỉnh

## E1. Vấn đề

`Create BA` ở BA Directory nên là popup hoàn chỉnh, không phải UI rời rạc hoặc form chưa đủ.

## E2. Behavior

* Click `Create BA`.
* Mở modal/popup.
* Form nằm trong modal.
* Submit thành công thì:

  * Modal đóng.
  * BA list refresh.
  * Toast success.
* Submit lỗi thì:

  * Modal vẫn mở.
  * Hiển thị lỗi inline.

## E3. Field cần có

Form tạo BA gồm:

```txt
Full name
Email
Level
Status
Skill/domain tags
Phone optional
Avatar optional
Joined date optional
```

Nếu CRM hiện có thêm field khác thì giữ lại nhưng không làm modal quá rối.

## E4. Validation

* Full name required.
* Email required.
* Email format.
* Email unique.
* Level required.
* Status default Active.
* Skill tags optional nhưng nên chọn được.

## E5. Acceptance Criteria

* [ ] Create BA mở modal.
* [ ] Modal có đầy đủ field cơ bản.
* [ ] Validation rõ ràng.
* [ ] Duplicate email bị chặn.
* [ ] Submit thành công refresh list.
* [ ] Modal không vỡ responsive.
* [ ] PM/PO không thấy Create BA.
* [ ] BA không thấy Create BA.

---

# PHẦN F — Files cần kiểm tra/sửa

```txt
apps/web/src/pages/MySchedulePage.tsx
apps/web/src/pages/MyRequestsPage.tsx
apps/web/src/pages/DashboardPage.tsx
apps/web/src/pages/ActionCenterPage.tsx
apps/web/src/pages/TimelinePage.tsx
apps/web/src/pages/BADirectoryPage.tsx

apps/web/src/components/schedule/*
apps/web/src/components/requests/*
apps/web/src/components/timeline/*
apps/web/src/components/ba/*
apps/web/src/components/ui/*

apps/web/src/lib/date*
apps/web/src/lib/capacity*
apps/web/src/lib/priority*
apps/web/src/lib/sorting*

apps/api/src/bookings/*
apps/api/src/ba/*
apps/api/src/capacity/*
```

---

# PHẦN G — Test bắt buộc

Chạy:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Manual QA theo role:

## BA

* [ ] BA thấy Timeline.
* [ ] Click Upcoming Work mở My Schedule tab Upcoming.
* [ ] My Schedule có Current/Upcoming/Completed.
* [ ] Upcoming hiển thị task tương lai.
* [ ] Completed không phải tab duy nhất.

## PM/PO

* [ ] My Requests desktop 3 card/hàng.
* [ ] Edit request mở popup.
* [ ] Edit Pending/Rejected được.
* [ ] Approved không edit được.
* [ ] Dashboard không còn Create Request.
* [ ] Create Request vẫn có ở Timeline/My Requests/BA Directory.

## BA Manager

* [ ] Dashboard chỉ có khoảng 5 action quan trọng.
* [ ] Flag không bị trùng nghĩa.
* [ ] Pending/priority request nằm trên.
* [ ] Approved xuống cuối Action Center.
* [ ] Quarter view timeline dễ nhìn.
* [ ] Current day/week/month được highlight.
* [ ] Week navigation đúng format.
* [ ] Click BA header sort theo capacity.
* [ ] Create BA mở modal hoàn chỉnh.

---

# PHẦN H — Completion Report

Sau khi làm xong, trả report:

```md
# COMPLETION REPORT — UI/UX FIX BATCH 03

## Status

DONE / PARTIAL / BLOCKED

## Files Changed

| File | Change |
|---|---|

## BA Role Fixes

| Item | Result | Evidence |
|---|---|---|
| Timeline visible | | |
| Upcoming Work -> My Schedule Upcoming | | |
| My Schedule tabs | | |

## PM/PO Fixes

| Item | Result | Evidence |
|---|---|---|
| My Requests 3 cards/row | | |
| Edit request popup | | |
| Remove dashboard create request | | |

## BA Manager Fixes

| Item | Result | Evidence |
|---|---|---|
| Dashboard simplified | | |
| Flag logic cleaned | | |
| Action Center sort | | |
| Quarter View improved | | |
| Current date highlight | | |
| Week navigation format | | |
| Sort BA by capacity | | |
| Create BA popup | | |

## Commands Run

| Command | Result |
|---|---|
| pnpm lint | |
| pnpm typecheck | |
| pnpm build | |
| pnpm test | |

## Business Rule Confirmation

- [ ] No hourly booking.
- [ ] Date range booking preserved.
- [ ] Capacity logic preserved.
- [ ] RBAC preserved.
- [ ] Private notes preserved.
- [ ] Mobile/tablet not broken.

## Remaining Issues

| Issue | Severity | Recommendation |
|---|---|---|
```
