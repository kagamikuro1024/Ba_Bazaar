# BA Booking App — UI Skill / Design System Guide

> Mục tiêu: đóng gói phong cách giao diện từ ảnh mẫu thành một **UI Skill** có thể đưa cho Codex/Claude Code/agent frontend thi công.  
> Phạm vi: màn hình quản lý booking BA theo timeline Gantt, capacity summary, request workflow, legend, rule cards và các trạng thái duyệt request.

---

## 1. Tinh thần thiết kế tổng thể

Giao diện cần mang cảm giác **enterprise SaaS hiện đại**, sáng, rõ ràng, tin cậy và dễ thao tác cho vai trò PM/PO, BA Manager và BA.

### 1.1. Từ khóa phong cách

- **Bright Enterprise Dashboard**: nền sáng, nhiều khoảng trắng, card rõ ràng.
- **Google Calendar Inspired**: timeline theo ngày/tuần, thanh booking kéo dài theo thời gian.
- **Capacity-first UX**: workload/capacity của từng BA phải nổi bật ngay từ cái nhìn đầu tiên.
- **Approval Workflow Friendly**: luồng request → pending → approve/reject cần trực quan, dễ hiểu.
- **Professional but friendly**: dùng màu tươi, icon mềm, bo góc vừa phải, tránh cảm giác quá “admin cũ”.

### 1.2. Nguyên tắc UX chính

1. Người dùng phải nhìn được ngay:
   - BA nào đang rảnh.
   - BA nào gần full hoặc đã full.
   - Slot nào còn trống để tạo request.
   - Request nào đã duyệt, đang chờ duyệt, hoặc bị từ chối.
2. Timeline là trung tâm của màn hình.
3. Capacity phải được thể hiện bằng cả **số phần trăm**, **màu sắc**, và **trạng thái text**.
4. Pending không chiếm slot chính thức nhưng vẫn phải hiển thị để cảnh báo nguy cơ overbook.
5. Manager có quyền quyết định cuối cùng, nên các khu vực duyệt phải có CTA rõ ràng.

---

## 2. Bố cục màn hình chính

Màn hình mẫu chia thành 3 khu vực lớn:

```txt
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. RESOURCE TIMELINE (GANTT-STYLE)                  │ 2. CAPACITY SUMMARY   │
│ Timeline booking theo BA/ngày/tuần                  │ Legend + Rules        │
├─────────────────────────────────────────────────────┴───────────────────────┤
│ 3. QUY TRÌNH XỬ LÝ REQUEST                                                  │
│ PM/PO tạo request → Pending → Manager duyệt → Kết quả sau duyệt             │
├─────────────────────────────────────────────────────────────────────────────┤
│ Footer Summary: nguyên tắc xử lý nhiều request cùng 1 BA                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1. Khu vực 1 — Resource Timeline

Đây là khối chính, chiếm khoảng 70–75% chiều rộng trên desktop.

Bao gồm:

- Header section:
  - Số thứ tự: `1.`
  - Tiêu đề: `RESOURCE TIMELINE (GANTT-STYLE)`
  - Subtitle: `PM/PO xem toàn cảnh workload của BA theo ngày/tuần`
- Filter bar:
  - Filter BA: `Tất cả BA`
  - Filter Project: `Tất cả Project`
  - View mode: `Tuần`
  - Nút điều hướng tuần trước/sau.
  - Nút `Today` hoặc `Tuần này`.
  - Legend mini: Approved, Pending, Available.
- Timeline table:
  - Cột trái: thông tin BA.
  - Cột phải: các ngày trong tuần.
  - Row theo từng BA.
  - Booking bar nằm trong timeline.

### 2.2. Khu vực 2 — Capacity Summary

Nằm bên phải timeline, dạng stack card dọc.

Bao gồm:

1. Card tổng hợp workload:
   - Donut chart trung tâm.
   - Số phần trăm trung bình: ví dụ `72%`.
   - Legend theo nhóm workload:
     - `0 - 40%`: Rảnh.
     - `40 - 80%`: Đang có việc.
     - `80 - 100%`: Gần full.
     - `> 100%`: Overbook.
2. Card chú thích trạng thái booking:
   - Approved.
   - Pending.
   - Available.
3. Card quy tắc capacity:
   - Approved trong cùng khoảng thời gian không vượt 100%.
   - Pending không khóa lịch chính thức nhưng được tính vào cảnh báo.
   - Manager là người quyết định cuối cùng.

### 2.3. Khu vực 3 — Request Workflow

Nằm dưới timeline, hiển thị quy trình 4 bước từ trái sang phải.

Các bước:

1. `PM/PO TẠO REQUEST`
2. `REQUEST PENDING`
3. `MANAGER XEM & DUYỆT`
4. `KẾT QUẢ SAU DUYỆT`

Mỗi bước là một card riêng, nối với nhau bằng mũi tên.

### 2.4. Footer Summary

Một thanh ngang ở cuối màn hình, nền xanh rất nhạt, tóm tắt rule quan trọng.

Nội dung gợi ý:

- PM/PO có thể gửi nhiều request cho cùng 1 BA.
- Pending không khóa lịch chính thức nhưng hiển thị để cảnh báo.
- Hệ thống tính tổng capacity approved + pending để cảnh báo overbook.
- BA Manager quyết định approve/reject và phản hồi cuối cùng.

---

## 3. Design Tokens

### 3.1. Màu nền

```css
--bg-page: #F8FAFC;
--bg-card: #FFFFFF;
--bg-soft-blue: #EFF6FF;
--bg-soft-yellow: #FEFCE8;
--bg-soft-green: #ECFDF5;
--bg-soft-red: #FEF2F2;
--bg-soft-purple: #F5F3FF;
```

### 3.2. Màu chữ

```css
--text-primary: #0F172A;
--text-secondary: #475569;
--text-muted: #64748B;
--text-placeholder: #94A3B8;
--text-inverse: #FFFFFF;
```

### 3.3. Màu trạng thái capacity

```css
--capacity-free: #16A34A;        /* 0 - 40% */
--capacity-working: #EAB308;     /* 40 - 80% */
--capacity-near-full: #F97316;   /* 80 - 100% */
--capacity-overbook: #E11D48;    /* > 100% */
```

### 3.4. Màu trạng thái request / booking

```css
--booking-approved-blue: #2563EB;
--booking-approved-green: #16A34A;
--booking-approved-purple: #7C3AED;
--booking-pending-bg: #FEF9C3;
--booking-pending-border: #EAB308;
--booking-pending-text: #854D0E;
--booking-available-bg: #F8FAFC;
--booking-available-border: #CBD5E1;
--booking-rejected-bg: #FEE2E2;
--booking-rejected-text: #B91C1C;
```

### 3.5. Border, shadow, radius

```css
--border-subtle: #E2E8F0;
--border-strong: #CBD5E1;

--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 14px;
--radius-xl: 18px;

--shadow-card: 0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);
--shadow-floating: 0 8px 24px rgba(15, 23, 42, 0.12);
```

### 3.6. Typography

Dùng font sans-serif hiện đại, ưu tiên:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Quy mô chữ:

```css
--font-xs: 12px;
--font-sm: 13px;
--font-md: 14px;
--font-lg: 16px;
--font-xl: 20px;
--font-2xl: 24px;
```

Quy tắc:

- Title section: 18–20px, font-weight 700.
- Card title: 14–16px, font-weight 700.
- Body text: 13–14px, font-weight 400–500.
- Badge text: 12px, font-weight 600.
- Booking bar text: 12–13px, font-weight 600, màu trắng với approved, màu nâu với pending.

---

## 4. Component Specification

## 4.1. AppShell

### Mục tiêu

Container tổng cho toàn bộ màn hình.

### Layout

```tsx
<AppShell>
  <MainDashboard />
</AppShell>
```

### Style

- Background: `--bg-page`.
- Padding desktop: `24px`.
- Padding tablet: `16px`.
- Padding mobile: `12px`.
- Max width desktop: có thể full width, ưu tiên dashboard rộng.

---

## 4.2. SectionHeader

### Props

```ts
type SectionHeaderProps = {
  index: number;
  title: string;
  subtitle?: string;
};
```

### UI

```txt
1. RESOURCE TIMELINE (GANTT-STYLE)
PM/PO xem toàn cảnh workload của BA theo ngày/tuần
```

### Style

- Index + title: màu `#1E3A8A` hoặc `#1D4ED8`.
- Title uppercase.
- Subtitle màu `--text-secondary`.
- Spacing bottom: 12px.

---

## 4.3. DashboardGrid

### Desktop layout

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
}
```

### Tablet layout

```css
.dashboard-grid {
  grid-template-columns: 1fr;
}
```

### Mobile layout

- Timeline có thể horizontal scroll.
- Capacity summary nằm dưới timeline.
- Workflow chuyển từ 4 cột ngang sang stack dọc.

---

## 4.4. FilterBar

### Thành phần

- Select BA.
- Select Project.
- Select view mode: `Ngày`, `Tuần`, `Tháng`.
- Button previous.
- Button next.
- Button today.
- Mini legend.

### Props

```ts
type FilterBarProps = {
  selectedBA: string | null;
  selectedProject: string | null;
  viewMode: 'day' | 'week' | 'month';
  onBAChange: (value: string | null) => void;
  onProjectChange: (value: string | null) => void;
  onViewModeChange: (value: 'day' | 'week' | 'month') => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
};
```

### Style

- Card nhỏ bên trong timeline card.
- Height: 40–44px.
- Select bo góc 8px.
- Border: `--border-subtle`.
- Background: white.
- Gap: 8px.

---

## 4.5. ResourceTimelineCard

### Mục tiêu

Hiển thị toàn cảnh workload BA theo dạng Gantt.

### Props

```ts
type ResourceTimelineCardProps = {
  bas: BAResource[];
  days: TimelineDay[];
  bookings: BookingItem[];
  pendingRequests: BookingItem[];
  selectedRange?: DateRange;
  onCreateRequest: (baId: string, dateRange: DateRange) => void;
  onBookingClick: (bookingId: string) => void;
};
```

### Data model gợi ý

```ts
type BAResource = {
  id: string;
  name: string;
  level: 'Junior BA' | 'Middle BA' | 'Senior BA';
  avatarUrl?: string;
  capacityPercent: number;
};

type TimelineDay = {
  date: string; // ISO date
  label: string; // T2, T3, T4...
  displayDate: string; // 01/06
  isToday?: boolean;
  isWeekend?: boolean;
};

type BookingStatus = 'approved' | 'pending' | 'rejected' | 'available';

type BookingItem = {
  id: string;
  baId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  capacityPercent: number;
  status: BookingStatus;
  color?: 'blue' | 'green' | 'purple';
};

type DateRange = {
  startDate: string;
  endDate: string;
};
```

---

## 4.6. Timeline Row

Mỗi row gồm 2 phần:

```txt
┌──────────────────────────┬──────────────────────────────────────────────┐
│ BA info                  │ Timeline cells + booking bars                │
└──────────────────────────┴──────────────────────────────────────────────┘
```

### BA Info Cell

Gồm:

- Avatar tròn.
- Tên BA.
- Level.
- Capacity percent ở bên phải.

Ví dụ:

```txt
[avatar] Phạm Ngọc Chi       60%
         Senior BA
```

### Capacity text color

```ts
function getCapacityColor(percent: number) {
  if (percent > 100) return 'var(--capacity-overbook)';
  if (percent >= 80) return 'var(--capacity-near-full)';
  if (percent >= 40) return 'var(--capacity-working)';
  return 'var(--capacity-free)';
}
```

### Timeline Cells

- Mỗi ngày là một cột.
- Row height: 68–76px.
- Border dọc nhạt giữa các ngày.
- Weekend có background hơi xám/tím nhạt.
- Today có vertical dashed line màu xanh.

---

## 4.7. BookingBar

### Mục tiêu

Thanh booking kéo dài từ start date đến end date.

### Props

```ts
type BookingBarProps = {
  item: BookingItem;
  left: number;
  width: number;
  onClick: () => void;
};
```

### Approved style

- Background solid.
- Text màu trắng.
- Border none.
- Shadow nhẹ.
- Height: 28–32px.
- Border radius: 6px.

Màu theo project hoặc trạng thái:

```css
.booking-approved-blue { background: linear-gradient(90deg, #2563EB, #1D4ED8); }
.booking-approved-green { background: linear-gradient(90deg, #16A34A, #15803D); }
.booking-approved-purple { background: linear-gradient(90deg, #7C3AED, #6D28D9); }
```

### Pending style

- Background vàng rất nhạt.
- Border dashed vàng.
- Text nâu.
- Không dùng shadow mạnh.

```css
.booking-pending {
  background: var(--booking-pending-bg);
  border: 1px dashed var(--booking-pending-border);
  color: var(--booking-pending-text);
}
```

### Available slot style

- Background trắng hoặc xám rất nhạt.
- Border dashed xám/xanh.
- Hatch pattern nhẹ.
- Khi hover hiển thị CTA: `+ Tạo request`.

```css
.available-slot {
  background: repeating-linear-gradient(
    -45deg,
    #F8FAFC,
    #F8FAFC 6px,
    #EEF2F7 6px,
    #EEF2F7 12px
  );
  border: 1px dashed #CBD5E1;
}
```

### Interaction

- Hover approved/pending booking:
  - cursor pointer.
  - transform: translateY(-1px).
  - show tooltip hoặc popover chi tiết.
- Click available slot:
  - mở modal tạo request.
- Drag selection optional:
  - cho phép chọn khoảng ngày/giờ.

---

## 4.8. CapacitySummaryCard

### Mục tiêu

Tổng hợp workload hiện tại của BA.

### Props

```ts
type CapacitySummaryCardProps = {
  averageCapacity: number;
  counts: {
    free: number;
    working: number;
    nearFull: number;
    overbook: number;
  };
};
```

### UI

```txt
[Donut 72%]
72%
Trung bình

● 0 - 40%    - Rảnh          2 BA
● 40 - 80%   - Đang có việc  2 BA
● 80 - 100%  - Gần full      1 BA
● > 100%     - Overbook      0 BA
```

### Donut chart

- Dùng SVG hoặc chart library.
- Đường tròn nền: `#E2E8F0`.
- Đường progress: gradient xanh → vàng nếu workload trung bình cao.
- Text ở giữa:
  - Percent lớn: 24–28px, bold.
  - Label nhỏ: 12–13px.

---

## 4.9. LegendCard

### UI

```txt
CHÚ THÍCH
[blue solid] Approved (đã duyệt)
[yellow dashed] Pending (chờ duyệt)
[gray hatch] Available (trống)
```

### Style

- Card trắng.
- Border nhẹ.
- Title uppercase.
- Legend item cao 28–32px.

---

## 4.10. CapacityRulesCard

### UI

```txt
QUY TẮC CAPACITY
• Tổng Approved trong cùng khoảng thời gian không vượt 100%.
• Pending không chiếm slot chính thức, nhưng được tính vào cảnh báo.
• Manager là người quyết định cuối cùng.
```

### Style

- Card trắng.
- Text 13px.
- Bullet spacing thoáng.

---

## 4.11. WorkflowSection

### Layout desktop

```css
.workflow-grid {
  display: grid;
  grid-template-columns: 1fr 40px 1fr 40px 1fr 40px 1.25fr;
  align-items: stretch;
  gap: 12px;
}
```

### Layout mobile

- Stack dọc.
- Mũi tên chuyển thành arrow down.

---

## 4.12. WorkflowStepCard

### Props

```ts
type WorkflowStepCardProps = {
  stepNumber: number;
  title: string;
  tone: 'blue' | 'yellow' | 'purple' | 'green';
  children: React.ReactNode;
};
```

### Tone style

```css
.step-blue {
  border-color: #BFDBFE;
  background: #EFF6FF;
}

.step-yellow {
  border-color: #FDE68A;
  background: #FEFCE8;
}

.step-purple {
  border-color: #DDD6FE;
  background: #F5F3FF;
}

.step-green {
  border-color: #BBF7D0;
  background: #ECFDF5;
}
```

---

## 4.13. CreateRequestCard

### UI Fields

```txt
PM Minh tạo request cho BA Khoa

BA          [avatar] Lê Đăng Khoa
Project     Mobile Onboarding
Thời gian   04/06/2026 - 10/06/2026
Capacity    50% (Part-time)
Priority    High

[Submit Request]
```

### Field style

- Label width cố định: 80–90px.
- Value bên phải.
- Icon nhỏ trước label hoặc value.
- Priority badge:
  - High: nền đỏ nhạt, text đỏ.
  - Medium: nền vàng nhạt, text vàng/nâu.
  - Low: nền xanh nhạt, text xanh.

### Submit button

```css
.btn-primary {
  background: linear-gradient(90deg, #2563EB, #1D4ED8);
  color: white;
  border-radius: 8px;
  height: 36px;
  font-weight: 600;
}
```

---

## 4.14. PendingRequestCard

### UI

```txt
Request được tạo với trạng thái Pending

[avatar] Lê Đăng Khoa      [Pending]
         Mobile Onboarding
         04/06 - 10/06 | 50%

[warning icon]
BA này hiện đang có 0% approved
Nhưng có 1 pending request khác 100% trong khoảng thời gian này.
```

### Style

- Request item: card trắng, border nhẹ.
- Pending badge: nền vàng nhạt, text vàng/nâu.
- Warning box: nền vàng nhạt, border vàng.

---

## 4.15. ManagerReviewCard

### UI

```txt
BA Manager xem các request chờ duyệt

[avatar] Lê Đăng Khoa      [Pending]
         Mobile Onboarding
         04/06 - 10/06 | 50%

[avatar] Lê Đăng Khoa      [Pending]
         CRM Revamp
         05/06 - 12/06 | 100%

[Approve] [Reject] [Xem chi tiết]
```

### Button style

```css
.btn-approve {
  background: #16A34A;
  color: white;
}

.btn-reject {
  background: #DC2626;
  color: white;
}

.btn-secondary {
  background: white;
  color: #0F172A;
  border: 1px solid #CBD5E1;
}
```

---

## 4.16. ApprovalResultCard

### UI

```txt
✓ Approve    Request 50% được duyệt
[avatar] Lê Đăng Khoa      [Approved]
         Mobile Onboarding
         04/06 - 10/06 | 50%

✕ Reject     Request 100% bị từ chối
[avatar] Lê Đăng Khoa      [Rejected]
         CRM Revamp
         05/06 - 12/06 | 100%
Lý do: BA đã đủ capacity trong giai đoạn này
```

### Style

- Approve block: icon xanh, title xanh.
- Reject block: icon đỏ, title đỏ.
- Approved badge: nền xanh nhạt, text xanh.
- Rejected badge: nền đỏ nhạt, text đỏ.

---

## 4.17. FooterRuleSummary

### UI

Dạng horizontal info bar với 4 item.

```txt
[bell icon] PM/PO có thể gửi nhiều request cho cùng 1 BA.
[group icon] Pending không khóa lịch chính thức, nhưng hiển thị để cảnh báo.
[chart icon] Hệ thống tính tổng capacity approved + pending để cảnh báo overbook.
[shield icon] BA Manager quyết định approve/reject và phản hồi cuối cùng.
```

### Style

- Background: `#F0F9FF` hoặc `#EFF6FF`.
- Border: `#BAE6FD`.
- Radius: 12px.
- Grid 4 columns desktop, 2 columns tablet, 1 column mobile.

---

## 5. Responsive Behavior

### Desktop >= 1280px

- Timeline và capacity summary nằm ngang.
- Workflow 4 bước nằm cùng một hàng.
- Timeline có thể hiển thị đủ 7 ngày trong tuần.

### Tablet 768px–1279px

- Capacity summary chuyển xuống dưới timeline.
- Timeline vẫn giữ horizontal scroll nếu thiếu chiều rộng.
- Workflow có thể chia 2 hàng.

### Mobile < 768px

- Header/filter stack dọc.
- Timeline có horizontal scroll.
- BA info column sticky bên trái.
- Workflow stack dọc.
- Footer summary stack dọc.

```css
.timeline-scroll {
  overflow-x: auto;
}

.ba-column {
  position: sticky;
  left: 0;
  z-index: 2;
  background: white;
}
```

---

## 6. Interaction Rules

## 6.1. Tạo request

Người dùng có thể tạo request theo 2 cách:

1. Click vào available slot trong timeline.
2. Click nút `+ Tạo request` ở một khoảng trống.

Sau khi click:

- Mở modal/drawer tạo request.
- Tự fill BA và khoảng thời gian nếu click từ timeline.
- Người dùng chọn project, capacity, priority, ghi chú.
- Submit xong request ở trạng thái `Pending`.

## 6.2. Click booking bar

Khi click vào booking:

- Mở popover hoặc side panel chi tiết.
- Hiển thị:
  - BA.
  - Project.
  - Thời gian.
  - Capacity.
  - Status.
  - Người tạo request.
  - Người duyệt.
  - Ghi chú.

## 6.3. Cảnh báo overbook

Hệ thống phải tính:

```ts
approvedCapacityInRange + pendingCapacityInRange
```

Nếu tổng > 100%, hiển thị warning:

```txt
BA này có nguy cơ overbook trong khoảng thời gian đã chọn.
Approved: 50%
Pending: 100%
Tổng dự kiến: 150%
```

## 6.4. Duyệt request

Manager có thể:

- Approve.
- Reject.
- Xem chi tiết.

Khi reject nên yêu cầu lý do hoặc có preset lý do:

- BA đã đủ capacity trong giai đoạn này.
- Trùng lịch dự án ưu tiên cao hơn.
- Request thiếu thông tin.
- Cần điều chỉnh capacity/thời gian.

---

## 7. Trạng thái dữ liệu cần hỗ trợ

### 7.1. Empty state

Khi chưa có booking:

```txt
Chưa có booking nào trong tuần này.
Click vào ô trống để tạo request đầu tiên.
```

### 7.2. Loading state

- Skeleton cho timeline row.
- Skeleton cho capacity card.
- Không dùng spinner lớn che toàn màn hình nếu không cần.

### 7.3. Error state

```txt
Không thể tải dữ liệu booking.
[Vui lòng thử lại]
```

### 7.4. Permission state

Nếu BA thường không có quyền approve:

- Ẩn nút Approve/Reject.
- Chỉ hiển thị trạng thái request.

---

## 8. Accessibility

- Tất cả màu trạng thái phải có text label đi kèm, không chỉ dựa vào màu.
- Booking bar phải có `aria-label` mô tả đầy đủ.
- Button approve/reject phải có label rõ.
- Timeline cell có thể focus bằng keyboard.
- Contrast text trên booking bar phải đủ rõ.
- Tooltip không được là nơi duy nhất chứa thông tin quan trọng.

Ví dụ aria-label:

```tsx
aria-label="Booking approved: Payment Refund Flow, Phạm Ngọc Chi, 50 percent capacity, from 01/06 to 05/06"
```

---

## 9. Animation & Micro-interactions

Giữ animation nhẹ, chuyên nghiệp:

- Card hover: `translateY(-1px)`, shadow tăng nhẹ.
- Booking hover: highlight border hoặc shadow.
- Modal open: fade + slide từ phải.
- Approve success: icon check xuất hiện nhẹ.
- Reject: không dùng animation quá gắt.

```css
.interactive-card {
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.interactive-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-floating);
}
```

---

## 10. Gợi ý cấu trúc component frontend

```txt
src/
  components/
    dashboard/
      AppShell.tsx
      SectionHeader.tsx
      DashboardGrid.tsx
      FilterBar.tsx
      ResourceTimelineCard.tsx
      TimelineHeader.tsx
      TimelineRow.tsx
      BookingBar.tsx
      AvailableSlot.tsx
      CapacitySummaryCard.tsx
      LegendCard.tsx
      CapacityRulesCard.tsx
      WorkflowSection.tsx
      WorkflowStepCard.tsx
      CreateRequestCard.tsx
      PendingRequestCard.tsx
      ManagerReviewCard.tsx
      ApprovalResultCard.tsx
      FooterRuleSummary.tsx
    ui/
      Button.tsx
      Badge.tsx
      Card.tsx
      Avatar.tsx
      Select.tsx
      Tooltip.tsx
      Modal.tsx
      Drawer.tsx
  styles/
    tokens.css
    globals.css
  data/
    mock-ba-resources.ts
    mock-bookings.ts
```

---

## 11. Mock data theo ảnh mẫu

```ts
export const baResources = [
  {
    id: 'ba-001',
    name: 'Phạm Ngọc Chi',
    level: 'Senior BA',
    capacityPercent: 60,
    avatarUrl: '/avatars/pham-ngoc-chi.png',
  },
  {
    id: 'ba-002',
    name: 'Đỗ Anh Dũng',
    level: 'Middle BA',
    capacityPercent: 100,
    avatarUrl: '/avatars/do-anh-dung.png',
  },
  {
    id: 'ba-003',
    name: 'Nguyễn Bảo An',
    level: 'Junior BA',
    capacityPercent: 30,
    avatarUrl: '/avatars/nguyen-bao-an.png',
  },
  {
    id: 'ba-004',
    name: 'Lê Đăng Khoa',
    level: 'Middle BA',
    capacityPercent: 0,
    avatarUrl: '/avatars/le-dang-khoa.png',
  },
  {
    id: 'ba-005',
    name: 'Bùi Phương Thảo',
    level: 'Senior BA',
    capacityPercent: 90,
    avatarUrl: '/avatars/bui-phuong-thao.png',
  },
];

export const bookings = [
  {
    id: 'booking-001',
    baId: 'ba-001',
    projectName: 'Payment Refund Flow',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    capacityPercent: 50,
    status: 'approved',
    color: 'blue',
  },
  {
    id: 'booking-002',
    baId: 'ba-001',
    projectName: 'CRM Revamp',
    startDate: '2026-06-03',
    endDate: '2026-06-06',
    capacityPercent: 50,
    status: 'pending',
  },
  {
    id: 'booking-003',
    baId: 'ba-002',
    projectName: 'Logistics Tracking',
    startDate: '2026-06-01',
    endDate: '2026-06-06',
    capacityPercent: 100,
    status: 'approved',
    color: 'green',
  },
  {
    id: 'booking-004',
    baId: 'ba-003',
    projectName: 'HR Approval Workflow',
    startDate: '2026-06-03',
    endDate: '2026-06-06',
    capacityPercent: 30,
    status: 'approved',
    color: 'purple',
  },
  {
    id: 'booking-005',
    baId: 'ba-005',
    projectName: 'BI Dashboard',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    capacityPercent: 50,
    status: 'approved',
    color: 'blue',
  },
  {
    id: 'booking-006',
    baId: 'ba-005',
    projectName: 'Internal Portal',
    startDate: '2026-06-01',
    endDate: '2026-06-06',
    capacityPercent: 40,
    status: 'pending',
  },
];
```

---

## 12. Acceptance Criteria cho UI

Agent/frontend cần hoàn thành các tiêu chí sau:

### Timeline

- [ ] Hiển thị danh sách BA với avatar, tên, level, capacity percent.
- [ ] Hiển thị timeline theo tuần với 7 ngày.
- [ ] Hiển thị booking approved bằng thanh màu solid.
- [ ] Hiển thị booking pending bằng thanh vàng nhạt, border dashed.
- [ ] Hiển thị slot trống bằng hatch pattern hoặc border dashed.
- [ ] Có vertical line cho ngày hiện tại.
- [ ] Click slot trống mở flow tạo request.
- [ ] Click booking mở chi tiết booking.

### Capacity Summary

- [ ] Có donut chart workload trung bình.
- [ ] Có phân nhóm workload theo 4 mức.
- [ ] Màu capacity đúng theo rule.
- [ ] Có legend approved/pending/available.
- [ ] Có card quy tắc capacity.

### Workflow

- [ ] Có 4 step đúng thứ tự.
- [ ] Có mũi tên nối giữa các step trên desktop.
- [ ] Có card tạo request.
- [ ] Có trạng thái pending.
- [ ] Có màn manager review với approve/reject.
- [ ] Có kết quả approve/reject.

### Responsive

- [ ] Desktop hiển thị 2 cột timeline + summary.
- [ ] Tablet chuyển summary xuống dưới.
- [ ] Mobile timeline scroll ngang.
- [ ] Workflow stack dọc trên mobile.

### Visual Quality

- [ ] Giao diện sáng, hiện đại, đúng chất enterprise.
- [ ] Card spacing thoáng.
- [ ] Màu sắc nhất quán.
- [ ] Typography rõ ràng.
- [ ] Không bị rối khi có nhiều booking.

---

## 13. Prompt ngắn cho Codex/Claude Code

```md
Bạn là senior frontend engineer. Hãy xây dựng giao diện BA Booking Dashboard theo UI Skill này.

Yêu cầu:
- Giao diện sáng, hiện đại, enterprise SaaS.
- Timeline booking kiểu Google Calendar/Gantt.
- BA được book theo khoảng ngày/giờ và capacity phần trăm.
- Approved hiển thị bằng bar solid.
- Pending hiển thị bằng bar vàng dashed, không khóa slot chính thức nhưng tính vào cảnh báo.
- Available slot có hatch pattern và CTA + Tạo request.
- Có Capacity Summary với donut chart, legend và rules.
- Có workflow 4 bước: tạo request → pending → manager duyệt → kết quả.
- Responsive tốt cho desktop/tablet/mobile.
- Tách component rõ ràng, dùng mock data trước nếu backend chưa sẵn sàng.
- Code sạch, dễ mở rộng, có type rõ ràng.
```

---

## 14. Gợi ý thư viện nếu dùng React/Vite

- UI base: Tailwind CSS + shadcn/ui hoặc tự viết component nhẹ.
- Icons: lucide-react.
- Date handling: date-fns.
- Chart: recharts hoặc SVG tự viết cho donut chart.
- Drag/drop/resize booking optional: dnd-kit.
- Calendar/time grid nâng cao optional: FullCalendar hoặc tự custom nếu cần kiểm soát UX giống ảnh.

---

## 15. Ghi chú mở rộng cho booking theo giờ

Ảnh mẫu đang thiên về booking theo ngày/tuần. Với yêu cầu thực tế book theo giờ, timeline nên hỗ trợ thêm view mode:

- `Day View`: cột giờ từ 08:00–18:00.
- `Week View`: mỗi ngày có các slot giờ hoặc thanh booking hiển thị theo offset thời gian.
- `Month View`: chỉ hiển thị tổng quan, không cần chi tiết giờ.

Data model nên có `startDateTime` và `endDateTime` thay vì chỉ `startDate`, `endDate`:

```ts
type BookingItem = {
  id: string;
  baId: string;
  projectName: string;
  startDateTime: string; // ISO datetime
  endDateTime: string;   // ISO datetime
  capacityPercent: number;
  status: 'approved' | 'pending' | 'rejected';
};
```

Trong week view, booking bar cần tính theo:

```ts
left = dayIndex * dayWidth + hourOffset * hourWidth;
width = durationInHours * hourWidth;
```

---

## 16. Definition of Done

Một bản UI đạt yêu cầu khi:

- Nhìn vào là hiểu đây là app booking BA/resource capacity.
- Có timeline đẹp, rõ, gần tinh thần Google Calendar.
- Có phân biệt rõ Approved/Pending/Available.
- Có capacity summary dễ hiểu.
- Có luồng request/duyệt trực quan.
- Có thể mở rộng sang booking theo giờ.
- Có responsive layout không vỡ trên mobile.
- Component sạch, data model rõ, dễ nối backend.
