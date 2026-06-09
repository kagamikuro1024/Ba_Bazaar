# TIP-UI-FIX-002 — Sửa UI Action Center, Sidebar, Timeline Compact và Request Detail

## 1. Mục tiêu

Sửa các lỗi UI mới phát sinh sau đợt remake dashboard:

1. Mất đường dẫn tới Manager Inbox.
2. Action Center đang thay thế Manager Inbox nhưng UI bị trùng/lỗi và không xuất hiện trên sidebar.
3. Sidebar chiếm nhiều diện tích, cần có chế độ thu gọn để tăng không gian hiển thị.
4. Timeline month/quarter view đã co lại nhưng cần giữ đúng tỉ lệ/vị trí tương quan giữa các task.
5. Booking Request Detail đang rối, cần tinh gọn.
6. Priority `High` và `Urgent` chưa phân biệt màu rõ.
7. Request cần sort theo mức độ quan trọng, không chỉ theo ngày.

---

## 2. Nguyên tắc không được thay đổi

Không sửa business logic booking.

Vẫn giữ:

```ts
start_date
end_date
capacity_percent
```

Không thêm:

```ts
start_time
end_time
start_datetime
end_datetime
hourly booking
```

Không sửa:

* API booking nếu không cần.
* Capacity calculation.
* Auth/RBAC.
* Database schema, trừ khi thật sự cần cho sort/filter priority.

---

# PHẦN A — Sửa điều hướng Manager Inbox / Action Center

## A1. Vấn đề

Hiện tại đường dẫn tới Manager Inbox bị mất. Có trang thay thế là Action Center nhưng:

* UI bị trùng với Manager Inbox hoặc Dashboard.
* Action Center không xuất hiện trên sidebar.
* Người dùng không biết phải vào đâu để xử lý request.
* Navigation bị thiếu điểm vào chính cho BA Manager.

## A2. Quyết định UI

Chốt dùng **một entry chính** trên sidebar:

```txt
Action Center
```

Action Center sẽ là nơi xử lý request/action cho BA Manager.

Không để `Manager Inbox` và `Action Center` tồn tại như 2 menu ngang hàng gây trùng lặp.

Nếu code vẫn có route Manager Inbox cũ, redirect về Action Center:

```txt
/manager/inbox  -> /manager/action-center
/action-center  -> /manager/action-center
```

## A3. Sidebar cần có với BA Manager

Sidebar BA Manager nên có:

```txt
Dashboard
Action Center
Timeline
BA Directory
Reports
```

Notification không nên là menu chính nếu đã có Action Center. Notification có thể là icon/bell ở header.

## A4. Route yêu cầu

Đảm bảo tồn tại route:

```txt
/manager/action-center
```

Route cũ vẫn không được 404:

```txt
/manager/inbox
```

Nếu user vào `/manager/inbox`, redirect hoặc render cùng component với Action Center.

## A5. Acceptance Criteria

* [ ] Sidebar BA Manager có menu `Action Center`.
* [ ] Click `Action Center` mở được trang xử lý request.
* [ ] `/manager/inbox` không bị mất, không 404.
* [ ] Nếu giữ `/manager/inbox`, nó redirect/render cùng Action Center.
* [ ] Không còn 2 UI trùng lặp gây bối rối.
* [ ] PM/PO và BA không thấy Action Center.
* [ ] PM/PO và BA truy cập direct route bị chặn.

---

# PHẦN B — Sửa UI Action Center

## B1. Mục tiêu

Action Center phải là trang xử lý request/action nhanh, không phải dashboard thứ hai.

## B2. Layout mới

Action Center dùng layout compact dạng list/table, không dùng nhiều box lớn.

Đề xuất:

```txt
Header:
Action Center
"Review, assign and resolve BA booking requests"

Top filters:
All | Urgent | Unassigned | Pending | Overbook Risk

Main list:
Priority | Type | Project | Requester | Requested/Assigned BA | Date Range | Status | Action
```

## B3. Không trùng Dashboard

Dashboard dùng để xem tổng quan business:

* Team utilization.
* Bench.
* Overbook.
* Man-day.
* Action summary.

Action Center dùng để thao tác:

* Review request.
* Assign BA.
* Approve.
* Reject.
* View detail.

## B4. Request row cần có

Mỗi dòng request cần có:

* Priority badge.
* Request type:

  * Specific BA.
  * Open Request.
* Project/task.
* Requester.
* Requested BA / Assignment.
* Date range.
* Status.
* Main action button.

Không cần hiển thị quá nhiều field trên row.

## B5. Acceptance Criteria

* [ ] Action Center không giống copy của Dashboard.
* [ ] Request hiển thị dạng list/table compact.
* [ ] Nhìn được nhiều request trong một màn hình.
* [ ] Có filter/tab theo All, Urgent, Unassigned, Pending, Overbook Risk.
* [ ] Có action chính: Review / Assign / Approve / Reject.
* [ ] Không dùng card quá to gây mất diện tích.

---

# PHẦN C — Sidebar có thể thu gọn

## C1. Vấn đề

Sidebar hiện chiếm nhiều chiều ngang, làm giảm không gian cho Timeline, Dashboard, Action Center.

## C2. Yêu cầu

Thêm chế độ collapse/expand sidebar trên desktop.

### Expanded mode

```txt
Width: 220–240px
Icon + label
```

### Collapsed mode

```txt
Width: 64–72px
Icon only
Tooltip khi hover
```

## C3. Behavior

* Có nút collapse ở sidebar hoặc header.
* Khi collapse, main content tự mở rộng.
* Trạng thái collapse có thể lưu localStorage.
* Không ảnh hưởng mobile/tablet nếu responsive cũ đang ổn.
* Mobile vẫn dùng responsive hiện tại, không refactor lớn.

## C4. Acceptance Criteria

* [ ] Sidebar có nút thu gọn/mở rộng.
* [ ] Khi thu gọn, content rộng hơn.
* [ ] Icon vẫn hiển thị rõ.
* [ ] Hover có tooltip hoặc title.
* [ ] Active nav vẫn nhận biết được.
* [ ] Không làm vỡ mobile/tablet.
* [ ] State sidebar được giữ khi reload nếu có localStorage.

---

# PHẦN D — Timeline Month/Quarter Compact giữ đúng tỉ lệ task

## D1. Vấn đề

Timeline đã co theo tháng/quý nhưng cần đảm bảo task vẫn hiển thị đúng **tỉ lệ và vị trí tương quan**.

Nghĩa là:

* Booking đầu tháng phải nằm gần đầu trục.
* Booking giữa tháng nằm giữa.
* Booking cuối tháng nằm cuối.
* Booking dài 3 tuần phải dài hơn booking 1 tuần.
* Không chỉ gom cứng mỗi task vào một ô tuần làm mất tương quan.

## D2. Yêu cầu hiển thị

### Week View

Chi tiết theo ngày:

```txt
Mon | Tue | Wed | Thu | Fri
```

### Month View

Cột chính có thể là tuần:

```txt
Week 1 | Week 2 | Week 3 | Week 4 | Week 5
```

Nhưng booking bar bên trong cần tính vị trí theo ngày trong tháng để giữ tương quan.

Ví dụ:

```txt
Month width = 100%
Booking 06/06 → 20/06
left = position of 06/06 in month
width = duration 06/06→20/06 relative to month
```

### Quarter View

Cột chính là tháng:

```txt
Jun | Jul | Aug
```

Nhưng booking bar vẫn tính vị trí theo ngày trong quý.

## D3. Công thức đề xuất

Với month view:

```ts
monthStart = startOfMonth(currentDate)
monthEnd = endOfMonth(currentDate)

visibleStart = max(booking.start_date, monthStart)
visibleEnd = min(booking.end_date, monthEnd)

leftPercent =
  daysBetween(monthStart, visibleStart) / totalDaysInMonth * 100

widthPercent =
  (daysBetween(visibleStart, visibleEnd) + 1) / totalDaysInMonth * 100
```

Với quarter view:

```ts
quarterStart = startOfQuarter(currentDate)
quarterEnd = endOfQuarter(currentDate)

leftPercent =
  daysBetween(quarterStart, visibleStart) / totalDaysInQuarter * 100

widthPercent =
  bookingVisibleDays / totalDaysInQuarter * 100
```

## D4. Visual

Trong Month/Quarter compact:

* Header có thể gom theo tuần/tháng.
* Booking bar dùng absolute positioning theo percent.
* Giữ tỷ lệ dài/ngắn của task.
* Nếu quá nhiều task overlap, stack theo hàng.
* Overbook vẫn nổi bật.

## D5. Acceptance Criteria

* [ ] Month View không cần kéo ngang quá nhiều.
* [ ] Header Month View gom theo tuần.
* [ ] Booking đầu/tháng/giữa/cuối tháng nằm đúng tương quan.
* [ ] Booking dài hiển thị dài hơn booking ngắn.
* [ ] Quarter View gom theo tháng.
* [ ] Booking trong Quarter View vẫn giữ vị trí tương đối theo ngày.
* [ ] Click/hover booking vẫn mở detail đúng.
* [ ] Overbook >100% vẫn highlight rõ.
* [ ] Không đổi business logic date range.

---

# PHẦN E — Tinh gọn Booking Request Detail

## E1. Vấn đề

Booking request detail đang hơi rối, có nhiều field không cần thiết cho decision nhanh.

Cần bỏ bớt:

* Request ID.
* Estimated capacity.
* Request type.

Giữ lại 4 ô chính:

```txt
Requested BA / Assignment
Requester
Priority
Date Range
```

## E2. Layout mới

Top summary trong request detail chỉ cần 4 ô:

```txt
┌────────────────────────┬──────────────┬──────────┬──────────────┐
│ Requested BA/Assignment│ Requester    │ Priority │ Date Range   │
└────────────────────────┴──────────────┴──────────┴──────────────┘
```

Bên dưới mới đến:

* Project/task name.
* Description.
* Capacity.
* Skill/domain tags nếu có.
* Conflict/capacity warning.
* Actions: Approve / Assign / Reject.

## E3. Requested BA / Assignment display

Nếu request có BA:

```txt
Requested BA: Nguyen Van A
```

Nếu request chưa có BA:

```txt
Assignment: Unassigned
```

Nếu Manager đã chọn BA trong assign flow:

```txt
Assignment: Nguyen Van A
```

## E4. Acceptance Criteria

* [ ] Request detail không còn hiển thị Request ID ở phần chính.
* [ ] Không còn Estimated Capacity ở top summary.
* [ ] Không còn Request Type ở top summary.
* [ ] Top summary chỉ còn 4 ô:

  * Requested BA / Assignment.
  * Requester.
  * Priority.
  * Date Range.
* [ ] Detail dễ đọc hơn.
* [ ] Action approve/assign/reject vẫn dùng được.
* [ ] Các thông tin kỹ thuật nếu cần chỉ để trong debug/dev, không hiện mặc định.

---

# PHẦN F — Màu Priority High và Urgent rõ ràng hơn

## F1. Vấn đề

Priority `High` và `Urgent` chưa đủ khác biệt.

BA Manager cần nhìn một phát biết request nào cần xử lý trước.

## F2. Priority color rule

Đề xuất mapping:

```txt
Low       = gray
Medium    = blue
High      = orange / amber
Urgent    = red / rose, high contrast
```

## F3. UI style

### High

```txt
bg-orange-100
text-orange-800
border-orange-300
```

### Urgent

```txt
bg-red-100
text-red-800
border-red-300
icon warning hoặc pulse nhẹ nếu cần
```

Urgent có thể thêm:

```txt
🔥 Urgent
```

hoặc icon warning.

## F4. Acceptance Criteria

* [ ] High không giống Urgent.
* [ ] Urgent nổi bật nhất trong list.
* [ ] High dùng cam/amber.
* [ ] Urgent dùng đỏ/rose.
* [ ] Priority badge nhất quán ở:

  * Action Center.
  * Request detail.
  * My Requests.
  * Dashboard action list.
* [ ] Không dùng đỏ cho Rejected nếu đã chốt Rejected màu xám.

---

# PHẦN G — Sort request theo mức độ quan trọng

## G1. Vấn đề

Request đang sort theo ngày, nhưng BA Manager cần xử lý theo mức độ quan trọng.

## G2. Sort rule mới

Default sort cho Action Center / Manager request list:

```txt
1. Urgent
2. High
3. Overbook risk / capacity risk
4. Unassigned request
5. Pending lâu nhất
6. Medium
7. Low
```

Hoặc dùng điểm priority:

```ts
priorityScore = {
  URGENT: 400,
  HIGH: 300,
  MEDIUM: 200,
  LOW: 100
}

riskBonus = {
  overbookRisk: 50,
  unassigned: 30
}

finalScore = priorityScore + riskBonus
```

Sort:

```txt
finalScore DESC
createdAt ASC
```

Tức là cùng mức ưu tiên thì request cũ hơn lên trước.

## G3. Filter/sort UI

Có thể thêm dropdown:

```txt
Sort by:
- Priority first
- Oldest first
- Newest first
- Capacity risk
```

Default:

```txt
Priority first
```

## G4. Acceptance Criteria

* [ ] Action Center mặc định sort theo priority/risk.
* [ ] Urgent luôn nằm trên High.
* [ ] High nằm trên Medium/Low.
* [ ] Request có overbook risk được đẩy lên.
* [ ] Request unassigned được đẩy lên.
* [ ] Nếu cùng priority, request cũ hơn lên trước.
* [ ] Có thể đổi sort nếu UI đã có dropdown.
* [ ] My Requests của PM/PO có thể vẫn sort theo ngày, không bắt buộc đổi.

---

# PHẦN H — Files cần kiểm tra/sửa

Tìm các file liên quan:

```txt
apps/web/src/components/LayoutShell.tsx
apps/web/src/components/Sidebar*
apps/web/src/components/Navigation*
apps/web/src/pages/ActionCenterPage.tsx
apps/web/src/pages/ManagerInboxPage.tsx
apps/web/src/pages/DashboardPage.tsx
apps/web/src/pages/TimelinePage.tsx
apps/web/src/pages/MyRequestsPage.tsx
apps/web/src/components/requests/*
apps/web/src/components/timeline/*
apps/web/src/lib/status*
apps/web/src/lib/priority*
apps/web/src/lib/date*
apps/web/src/routes/*
```

Search:

```bash
grep -R "Action Center\|Manager Inbox\|manager/inbox\|priority\|Urgent\|High\|Request ID\|Estimated\|Request Type\|sidebar\|collapsed" apps/web/src
```

PowerShell:

```powershell
Select-String -Path "apps/web/src/**/*.*" -Pattern "Action Center|Manager Inbox|manager/inbox|priority|Urgent|High|Request ID|Estimated|Request Type|sidebar|collapsed"
```

---

# PHẦN I — Test bắt buộc

Chạy:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Manual test:

## Navigation

* [ ] Login BA Manager.
* [ ] Sidebar có Action Center.
* [ ] Click Action Center mở đúng trang.
* [ ] Vào `/manager/inbox` không bị 404.
* [ ] PM/PO không thấy Action Center.
* [ ] BA không thấy Action Center.

## Sidebar

* [ ] Click collapse sidebar.
* [ ] Content rộng ra.
* [ ] Click expand sidebar.
* [ ] Content trở lại bình thường.
* [ ] Reload vẫn giữ trạng thái nếu có localStorage.
* [ ] Mobile/tablet không bị vỡ.

## Timeline

* [ ] Week View hiển thị chi tiết.
* [ ] Month View co theo tuần.
* [ ] Quarter View co theo tháng.
* [ ] Task giữ đúng tỉ lệ/vị trí tương quan.
* [ ] Booking dài hiển thị dài hơn booking ngắn.
* [ ] Click booking mở detail.
* [ ] Overbook vẫn nổi bật.

## Request Detail

* [ ] Top summary chỉ còn 4 ô.
* [ ] Không còn Request ID ở phần chính.
* [ ] Không còn Estimated capacity ở top summary.
* [ ] Không còn Request type ở top summary.
* [ ] Approve/Assign/Reject vẫn hoạt động.

## Priority

* [ ] High màu cam/amber.
* [ ] Urgent màu đỏ/rose.
* [ ] Urgent nổi bật hơn High.
* [ ] Rejected không bị màu đỏ nếu rule đang là xám.

## Sorting

* [ ] Urgent nằm trên High.
* [ ] High nằm trên Medium.
* [ ] Risk/unassigned được đẩy lên.
* [ ] Cùng priority thì request cũ hơn lên trước.

---

# PHẦN J — Acceptance Criteria tổng

* [ ] Manager Inbox không bị mất route.
* [ ] Action Center xuất hiện trên sidebar.
* [ ] Action Center không trùng UI lỗi với Dashboard/Inbox.
* [ ] Sidebar có thể thu gọn.
* [ ] Timeline Month/Quarter compact nhưng vẫn giữ đúng tỉ lệ task.
* [ ] Booking Request Detail được tinh gọn.
* [ ] Priority High/Urgent phân biệt rõ.
* [ ] Request sort theo mức độ quan trọng.
* [ ] Không phá responsive mobile/tablet.
* [ ] Không đổi business logic booking.
* [ ] Build/test pass.

---

# PHẦN K — Completion Report

Sau khi làm xong, trả report:

```md
# COMPLETION REPORT — UI FIX 002

## Status

DONE / PARTIAL / BLOCKED

## Summary

- ...

## Files Changed

| File | Change |
|---|---|

## Fix Results

| Area | Result | Evidence |
|---|---|---|
| Manager Inbox route | | |
| Action Center sidebar | | |
| Action Center UI | | |
| Sidebar collapse | | |
| Timeline compact ratio | | |
| Request detail simplification | | |
| Priority colors | | |
| Request sorting | | |

## Commands Run

| Command | Result |
|---|---|
| pnpm lint | |
| pnpm typecheck | |
| pnpm build | |
| pnpm test | |

## Manual QA

| Scenario | Result | Notes |
|---|---|---|

## Business Rule Confirmation

- [ ] No hourly booking added.
- [ ] Date-range booking preserved.
- [ ] Capacity logic unchanged.
- [ ] RBAC unchanged.
- [ ] Responsive mobile/tablet not broken.

## Remaining Issues

| Issue | Severity | Recommendation |
|---|---|---|
```
