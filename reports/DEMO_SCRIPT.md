# 🎬 KỊCH BẢN DEMO + SCRIPT THUYẾT TRÌNH — BA BAZAAR (20 phút)

> **Cách dùng tờ này:** **NÓI** = lời thuyết trình (đọc gần như nguyên văn). **LÀM** = thao tác trên màn hình. Mục tiêu: 1 request đi xuyên suốt 3 role để vừa kể chuyện vừa lộ hết tính năng.
>
> **Mở sẵn trước khi bắt đầu:** 4 tab trình duyệt đã đăng nhập sẵn 4 vai trò (PM/PO, BA Manager, BA, IT Admin) ở `http://localhost:5173` để chuyển vai trò tức thì, khỏi gõ mật khẩu giữa demo.
>
> **Tài khoản:** PM/PO `pm1@ba-bazaar.local`/`Pmpo@123` · Manager `manager@ba-bazaar.local`/`Manager@123` · BA `ba1@ba-bazaar.local`/`Ba@123` · IT Admin `it-admin@ba-bazaar.local`/`ItAdmin@123`

---

## ⏱️ Bảng phân bổ thời gian (20 phút)

| Phần | Nội dung | Thời lượng |
|---|---|---|
| 0 | **Bài toán** (mở đầu) | 2.5 phút |
| 1 | Giải pháp & 3 vai trò | 0.5 phút |
| 2 | **Kịch bản 1 — PM/PO**: **Extract PRD** + AI Suggest + tạo request | 4.5 phút |
| 3 | **Kịch bản 2 — BA Manager** (trọng tâm): conflict, timeline, duyệt + **tạo BA** | 7.5 phút |
| 4 | **Kịch bản 3 — BA** xem lịch & AI tóm tắt | 2 phút |
| 5 | **Kịch bản 4 — IT Admin**: quản trị + **AI Observability** | 4 phút |
| 6 | Chốt + Q&A | 1 phút |

> Tổng ~22 phút. **Nếu cháy giờ:** rút gọn 3e (Reports), 5c (Audit chi tiết), 5a (Admin Dashboard), 4 (BA). **Giữ bằng được** 2 (Extract PRD + Suggest BA), 3c–3d (Timeline + chốt overbook), 5d (AI Observability) — đây là các điểm "ăn tiền" nhất.

---

## 0️⃣ BÀI TOÁN (trình bày đầu tiên — 3 phút)

**NÓI:**
> "Trước khi vào sản phẩm, em xin nói về bài toán.
>
> Các công ty phần mềm / agency thường có **một pool Business Analyst (BA)** dùng chung cho nhiều dự án. Câu hỏi hằng ngày của họ là: **dự án này nên giao cho BA nào, BA đó còn rảnh không, kỹ năng có khớp không?**
>
> Hiện tại đa số quản lý việc này bằng **Excel + chat tay**. Hậu quả là 4 nỗi đau:
> 1. **Overbook** — một BA bị nhận quá 100% công suất, vỡ tiến độ, nhưng tới lúc trễ deadline mới phát hiện.
> 2. **Bench lãng phí** — có BA ngồi không mà không ai biết để giao việc.
> 3. **Giao sai kỹ năng** — BA Fintech bị đẩy vào dự án Logistics vì 'ai rảnh thì giao'.
> 4. **Không có dữ liệu & vết kiểm toán** — không biết thực sự mỗi người làm bao nhiêu man-day để tính lương, lập kế hoạch, hay truy lại ai duyệt cái gì.
>
> **BA Bazaar** giải quyết bằng một nơi duy nhất: quản lý **công suất theo man-day thật**, một quy trình **Yêu cầu → AI gợi ý BA → Duyệt** có **chốt chặn cứng chống overbook**, và **AI trợ lý** xuyên suốt để ra quyết định nhanh. Em sẽ demo đúng một yêu cầu đi qua 3 vai trò để các anh/chị thấy toàn bộ."

*(Nếu có slide: 1 slide tiêu đề + 1 slide '4 nỗi đau' là đủ. Không có slide cũng nói được.)*

---

## 1️⃣ GIẢI PHÁP & 3 VAI TRÒ (1 phút)

**NÓI:**
> "Sản phẩm có **3 vai trò nghiệp vụ** và **1 vai trò quản trị**:
> - **PM/PO** — người *cần* BA, tạo yêu cầu.
> - **BA Manager** — người *điều phối* nguồn lực, duyệt & xử lý xung đột công suất, và **quản lý kho BA**.
> - **BA** — người *được giao* việc, xem lịch của mình.
> - **IT Admin** — *vận hành kỹ thuật*: quản lý user, phân quyền, nhật ký kiểm toán.
>
> Triết lý của bọn em: **AI hỗ trợ ra quyết định nhưng không tự ý thay đổi gì** — mọi gợi ý đều có dẫn chứng, con người là người bấm nút cuối cùng."

**LÀM:** mở tab PM/PO.

---

## 2️⃣ KỊCH BẢN 1 — PM/PO TẠO YÊU CẦU (4.5 phút)

**Bối cảnh NÓI:** *"Em là PM dự án mới **Digital Bank Onboarding** — một dự án Fintech. Em có sẵn **bản PRD** của dự án và cần tìm đúng BA cho 2 tuần tới."*

**LÀM + NÓI:**
1. **LÀM:** Vào **Timeline** (hoặc nút **Create booking**) → tạo một booking request mới: chọn dự án, khoảng ngày, mức công suất (vd 50%).
   **NÓI:** *"PM chọn dự án, khoảng ngày, và mức công suất cần."*
2. **LÀM:** Mở ô **"Extract Skill from PRD"** → **dán nội dung PRD Fintech** (file `DEMO_PRD_Fintech.md`) → bấm **Extract**. ⭐
   **NÓI:** *"Tính năng AI thứ nhất: **Trích kỹ năng từ PRD**. Thay vì PM tự đoán dự án cần kỹ năng gì, PM **dán nguyên PRD vào và để AI bóc tách**. Sau vài giây, AI đề xuất **đúng các kỹ năng cần** — Fintech, API Specification, BPMN, Data Analysis... — và **cấp độ phù hợp: SENIOR**, kèm **lý do cho từng đề xuất**. Quan trọng: AI **không bịa kỹ năng**, chỉ chọn từ **bộ kỹ năng chuẩn của tổ chức**. Một việc trước đây mất nhiều phút giờ còn vài giây — và nó **chuẩn hoá yêu cầu** để bước sau gợi ý chính xác."*
3. **LÀM:** Bấm **"Suggest BAs" / AI Suggest BA**.
   **NÓI:** *"Tính năng AI thứ hai — **Gợi ý BA**. Không random: **xếp hạng đúng theo các kỹ năng vừa bóc tách + công suất còn trống + độ phù hợp**, kèm lý do rõ ràng cho từng người: 'khớp kỹ năng Fintech', 'còn trống 60%', hay '**có xung đột công suất** nếu duyệt'. PM chọn đúng người trong vài giây thay vì hỏi khắp các nhóm chat."*
4. **LÀM:** Chọn một BA Senior Fintech mà hệ thống cảnh báo **Capacity conflict** (ví dụ Hoàng Minh Châu / Phạm Ngọc Chi đang bận). Submit.
   **NÓI:** *"Em cố tình chọn người đang khá bận để cho thấy điểm hay tiếp theo. Hệ thống **vẫn cho tạo** yêu cầu — nhưng gắn cờ **'Capacity conflict'** màu đỏ và báo: yêu cầu này có thể vượt 100% nếu được duyệt. **Bọn em phân biệt rõ:** *được phép tạo yêu cầu xung đột* (để Manager cân nhắc), nhưng *không được phép duyệt* nếu vượt 100%. Lát nữa các anh/chị sẽ thấy chốt chặn đó."*
5. **LÀM:** Vào **My Requests** — trạng thái Pending.
   **NÓI:** *"PM theo dõi mọi yêu cầu của mình ở đây: cái nào chờ duyệt, cái nào đã được giao. Minh bạch hoàn toàn."*

**Tính năng đã show:** **Extract Skill from PRD** (AI bóc kỹ năng + level, có lý do, không bịa), **AI Suggest BA** (xếp hạng theo kỹ năng + công suất), tạo request, cảnh báo conflict ngay lúc tạo, My Requests.

---

## 3️⃣ KỊCH BẢN 2 — BA MANAGER (trọng tâm — 7 phút)

**LÀM:** chuyển sang tab **BA Manager**. Vào **Dashboard**.

### 3a. Dashboard + AI Summary (1.5 phút)
**NÓI:** *"Manager mở lên là thấy ngay sức khỏe đội: **utilization toàn đội, số BA bench, số Capacity risk, số yêu cầu chờ duyệt**."*
- **LÀM:** Bấm nút **"Tóm tắt với AI"**.
  **NÓI:** *"AI tóm tắt **không tự chạy** — Manager **chủ động bấm** khi cần, để không tốn tài nguyên và không gây nhiễu. Và đây là điểm quan trọng: mỗi câu AI viết ra **đều kèm trích dẫn dữ liệu (C1, C2...)** — AI **không bịa**, chỉ đọc đúng số trên dashboard. Bản tóm tắt có thể **thu nhỏ** lại để không chiếm chỗ, và bấm **'Tạo lại'** là sinh bản mới."*

### 3b. Action Center — hàng đợi xử lý (1.5 phút)
**LÀM:** Vào **Action Center**.
**NÓI:** *"Đây là 'hộp thư xử lý' của Manager. Mọi yêu cầu đổ về đây, lọc nhanh theo **Urgent / Unassigned / Capacity conflict**. Yêu cầu Fintech vừa nãy đang nằm đây với cờ **Capacity conflict**."*
- **LÀM:** Lọc theo **Capacity conflict** → thấy request vừa tạo.

### 3c. Timeline — sự thật về công suất (2 phút) ⭐
**LÀM:** Vào **Timeline**.
**NÓI:** *"Đây là màn 'đắt' nhất. Timeline kiểu Gantt cho thấy ai đang làm gì. Hãy nhìn **con số % cạnh tên mỗi BA** — đây **không phải** con số bịa, mà là **% man-day thực tế trong khung đang xem** (tuần/tháng/quý), **đã trừ cuối tuần**, và **tính cả việc đã hoàn thành** — nên có thể dùng để **tính lương và lập kế hoạch**."*
- **LÀM:** Đổi view **Tuần → Tháng → Quý**.
  **NÓI:** *"Cùng một BA, % thay đổi theo khung thời gian — vì nó là khối lượng thực trong khung đó."*
- **LÀM:** Chỉ vào BA bị conflict (chip đỏ **Conflict**).
  **NÓI:** *"Chip **Conflict** đỏ nghĩa là: nếu duyệt thêm yêu cầu pending thì người này vượt 100%. Còn **'Invalid'** (hiếm) là dữ liệu đã lỡ vượt 100% — lỗi cần sửa. Hover vào số sẽ thấy tooltip: bao nhiêu man-day, công thức tính."*

### 3d. Chốt chặn chống Overbook + cách xử lý (2 phút) ⭐⭐
**LÀM:** Mở request conflict, bấm **Approve**.
**NÓI:** *"Và đây là **trái tim của sản phẩm**. Em bấm duyệt... hệ thống **chặn lại** và báo rõ: *'Không thể duyệt vì BA sẽ vượt 100% vào ngày X — đã có 70% được duyệt + 50% yêu cầu = 120%. Hãy giảm xuống còn ≤30%, giao BA khác, hoặc chia việc.'* Đây là khác biệt cốt lõi: **hệ thống không cho phép overbook bằng cách thủ công** — nó biến một lỗi vận hành thầm lặng thành một quyết định có kiểm soát."*
- **LÀM (cách 1):** Sửa **Capacity** của request xuống 30% → bấm **Save + Approve** → **duyệt thành công**.
  **NÓI:** *"Manager có thể **chỉnh công suất** để đưa tổng về đúng 100% rồi duyệt..."*
- **LÀM (cách 2, nói nhanh):** *"...hoặc **giao BA khác** (lại dùng AI Suggest để tìm người không conflict), hoặc **chia việc** cho 2 BA, hoặc **từ chối**. Bốn cách, đều có dẫn dắt rõ ràng."*

### 3e. Reports (nhanh, 30 giây)
**LÀM:** Vào **Reports**.
**NÓI:** *"Báo cáo điều hành: **utilization đội, tỷ lệ bench, số Capacity conflict**, **xuất CSV**, và cũng có **AI tóm tắt** kèm dự báo 'nếu duyệt hết pending thì utilization sẽ lên bao nhiêu'. Đủ để Manager báo cáo cấp trên."*

### 3f. BA Directory + Tạo BA mới (1.5 phút) ⭐
**LÀM:** Vào **BA Directory** (`/crm/ba`).
**NÓI:** *"Đây là 'kho nhân sự' — toàn bộ BA của đội kèm **cấp độ, kỹ năng, mức sẵn sàng**. Điểm mấu chốt: chính dữ liệu **kỹ năng** ở đây là thứ nuôi cho **AI Suggest BA** gợi ý chính xác lúc nãy."*
- **LÀM:** Bấm **Create BA / Add BA** → điền **Họ tên, Email, Mật khẩu, Cấp độ (Junior→Lead), ngày vào** → **Tạo**.
  **NÓI:** *"Manager **tự tạo hồ sơ BA mới** ngay trong app, không cần nhờ IT. BA mới xuất hiện ngay trong directory và trên timeline."*
- **LÀM:** Mở hồ sơ BA vừa tạo → **gắn kỹ năng (Add tag)** ví dụ *Fintech, BPMN*.
  **NÓI:** *"Gắn kỹ năng cho BA — và đây là **vòng khép kín**: BA này giờ có kỹ năng Fintech, nên lần sau PM tạo yêu cầu Fintech thì **AI sẽ tự gợi ý đúng người này**. Càng dùng, dữ liệu càng giàu, gợi ý càng chuẩn."*

**Tính năng đã show:** Dashboard + AI summary có trích dẫn (bấm tay, thu gọn, tạo lại), Action Center + bộ lọc, Timeline man-day utilization đa khung, phân biệt Conflict/Invalid, **chốt chặn duyệt >100% + 4 cách xử lý**, chỉnh capacity, Reports + CSV + dự báo, **BA Directory + tạo BA + gắn kỹ năng (nuôi AI Suggest)**.

---

## 4️⃣ KỊCH BẢN 3 — BA XEM LỊCH (2.5 phút)

**LÀM:** chuyển sang tab **BA** (Phạm Ngọc Chi).
**NÓI:** *"Khép vòng tròn: BA vừa được giao đăng nhập."*
- **LÀM:** Vào **My Schedule**.
  **NÓI:** *"BA thấy **việc đang làm, việc sắp tới, tải của tuần này**, và **cảnh báo nếu sắp quá tải**. Họ không cần hỏi ai — lịch của mình minh bạch."*
- **LÀM:** Bấm **AI tóm tắt** trên dashboard của BA.
  **NÓI:** *"BA cũng có AI tóm tắt riêng: 'tuần này bạn đang ở X%, dự án A còn Y ngày, tuần sau bắt đầu dự án B'. Cá nhân hoá, vẫn dựa trên dữ liệu thật."*
- **LÀM:** Mở **BA Directory** (nếu còn thời gian).
  **NÓI:** *"Và đây là 'chợ BA' — directory toàn bộ đội kèm kỹ năng, cấp độ, mức sẵn sàng. PM có thể tự tham khảo trước khi tạo yêu cầu."*

**Tính năng đã show:** My Schedule (current/upcoming/tải tuần/cảnh báo), AI summary cá nhân, BA Directory.

---

## 5️⃣ KỊCH BẢN 4 — IT ADMIN (quản trị hệ thống — 3 phút)

**LÀM:** chuyển tab **IT Admin** (`it-admin@ba-bazaar.local`). Vào **/admin/dashboard**.
**NÓI:** *"Để vận hành thật khi go-live, bọn em tách riêng vai trò **IT Admin** — quản trị kỹ thuật, **không** dính vào nghiệp vụ booking. Đây là phần mới nhất của sản phẩm."*

### 5a. Admin Dashboard
**NÓI:** *"Tổng quan hệ thống: **tổng số user, đang hoạt động / bị khoá, phân bố theo vai trò**, và **hoạt động gần đây**. IT Admin nhìn một phát biết tình trạng hệ thống."*

### 5b. User Management ⭐
**LÀM:** Vào **Users**.
**NÓI:** *"Quản lý toàn bộ tài khoản: tìm kiếm, lọc theo **vai trò & trạng thái**, xem **lần đăng nhập gần nhất**."*
- **LÀM:** Bấm **Create user** → điền tên/email/role → tạo.
  **NÓI:** *"Tạo user mới — hệ thống sinh **mật khẩu dùng một lần**, hiện đúng một lần để bàn giao an toàn (không lưu, không in ra log)."*
- **LÀM:** **Edit role** một user → đổi vai trò; rồi **Disable** / **Enable**; rồi **Reset password**.
  **NÓI:** *"Đổi vai trò, khoá/mở tài khoản, reset mật khẩu. Và có **chốt chặn an toàn**: không thể tự đổi vai trò hay tự khoá chính mình, và **không thể hạ cấp hay khoá IT Admin cuối cùng** — tránh tự khoá mình ra khỏi hệ thống. Đặc biệt: user bị **Disable là mất quyền đăng nhập ngay lập tức**, chặn ngay ở tầng xác thực."*

### 5c. Audit Logs
**LÀM:** Vào **Audit Logs**.
**NÓI:** *"Mọi thao tác nhạy cảm đều được ghi: **ai – làm gì – lúc nào – kết quả – IP**. Lọc theo hành động, kết quả (Success/Denied/Failure), hoặc khoảng ngày."*
- **LÀM:** Mở một entry (vd `USER_ROLE_CHANGED`) → xem chi tiết.
  **NÓI:** *"Chi tiết cho thấy giá trị **trước và sau** khi thay đổi — phục vụ truy vết và tuân thủ. Ngay cả một lần **bị từ chối truy cập cũng được ghi lại**."*

### 5d. AI Observability ⭐⭐ (điểm nhấn lớn)
**LÀM:** Vào **AI Observability** (`/admin/ai/observability`).
**NÓI:** *"Đây là phần em tự hào nhất ở khối quản trị. Vì sản phẩm dùng AI ở nhiều chỗ, bọn em **giám sát toàn bộ**: **tổng số phiên AI, tỷ lệ lỗi, độ trễ trung bình, chi phí token**, và **sức khỏe từng tính năng AI** — Suggest BA, Extract PRD, các bản tóm tắt — bật/tắt và % thành công."*
- **LÀM:** Vào **AI Sessions**.
  **NÓI:** *"Nhớ lúc nãy PM bấm **AI Suggest BA** và **Extract PRD** chứ? **Mỗi lần gọi AI được ghi lại thành một phiên** — và đây chính là các phiên đó: ai gọi, tính năng nào, model gì, mất bao lâu, kết quả ra sao. Mở một phiên ra là thấy cả **tool call, dữ liệu trích xuất, lỗi (nếu có), và phản hồi người dùng**. AI không còn là 'hộp đen' — đây là điều bắt buộc để vận hành AI nghiêm túc."*
- **LÀM:** Vào **AI Feature Flags** → bật/tắt thử một tính năng (vd *Suggest BA*).
  **NÓI:** *"Cực quan trọng cho vận hành: IT Admin **bật/tắt từng tính năng AI ngay tại đây — không cần sửa code hay deploy lại**. AI có sự cố thì tắt một nút là an toàn ngay, và mỗi lần bật/tắt đều vào audit."*
- **LÀM (nói nhanh):** Mở **AI Settings**.
  **NÓI:** *"Và cấu hình **model, phiên bản prompt, nhiệt độ, token tối đa**... đều quản lý ở đây."*

### 5e. Bảo mật
**NÓI:** *"Tất cả phân quyền chặt ở **cả backend**, không chỉ ẩn nút: vai trò khác gọi API `/api/admin/*` bị chặn **403** và còn bị ghi vào audit."*

**Tính năng đã show:** Admin dashboard, **quản lý user** (tạo + mật khẩu tạm, đổi role, khoá/mở, reset + guardrails), **audit log** (lọc + before/after), **AI Observability đầy đủ** (sessions, tool calls, lỗi, chi phí, feedback), **bật/tắt AI feature flags + AI settings**, **RBAC backend (403 + audit)**.

---

## 6️⃣ CHỐT (1 phút)

**NÓI:**
> "Tóm lại, BA Bazaar biến việc phân bổ BA từ **'đoán bằng Excel'** thành **một quy trình có dữ liệu, có AI hỗ trợ, và có chốt chặn chống overbook**:
> - PM tạo yêu cầu + **AI gợi ý đúng người**.
> - Manager thấy **công suất man-day thật**, và **không thể overbook bằng tay**.
> - BA có **lịch minh bạch**.
> - **IT Admin** quản trị toàn hệ thống và **giám sát mọi hoạt động AI** — chi phí, độ trễ, lỗi, và bật/tắt từng tính năng AI — sẵn sàng vận hành thật.
> - Tất cả **AI đều có dẫn chứng, không tự ý hành động**, được **giám sát đầy đủ**, và mọi thao tác đều có **vết kiểm toán**.
>
> Em xin nhận câu hỏi ạ."

---

## 🛟 PHỤ LỤC — Mẹo & câu hỏi dự phòng

**Mẹo demo trơn tru:**
- Mở sẵn **4 tab** đăng nhập 4 vai trò trước khi bắt đầu (đừng đăng nhập/đăng xuất giữa demo).
- **Để AI Observability có dữ liệu thật:** nhớ đã bấm **AI Suggest BA** + **Extract PRD** ở Kịch bản 1 *trước khi* sang IT Admin — lúc đó trang **AI Sessions** sẽ hiện đúng các phiên vừa gọi (khép vòng rất đẹp). Nếu chưa có phiên nào, vẫn demo tốt bằng **Feature health + Feature Flags + Settings**.
- Trước demo, vào Timeline kiểm tra có sẵn **một BA đang conflict** (vd Hoàng Minh Châu / Phạm Ngọc Chi). Nếu chưa có, dùng PM tạo nhanh 1 request 50–100% chồng lịch để tạo conflict trình diễn.
- Nếu AI summary chậm/lỗi mạng: sản phẩm **tự fallback** ra bản tóm tắt xác định (deterministic) — cứ nói *"đây là bản dự phòng khi không gọi được LLM, vẫn bám dữ liệu thật"*. Không panic.
- Nếu màn nào load chậm: chuyển sang nói về lợi ích trong lúc chờ.

**Câu hỏi dự phòng:**
- *"AI có tự ý giao việc không?"* → Không. AI chỉ **gợi ý + tóm tắt có dẫn chứng**; con người bấm nút cuối. Mọi action là điều hướng, không phải mutate.
- *"Chống overbook thế nào?"* → API **chặn cứng** mọi thao tác duyệt/giao làm tổng công suất approved >100% trong bất kỳ ngày làm việc nào, kèm gợi ý mức tối đa duyệt được.
- *"% man-day tính sao?"* → man-day phân bổ / số ngày làm việc trong khung (trừ T7-CN), tính cả việc đã hoàn thành — dùng được cho lương.
- *"Bảo mật/phân quyền?"* → RBAC ở cả frontend lẫn backend (gọi API admin sai vai trò bị 403), audit log mọi thao tác admin, masking dữ liệu nhạy cảm.
- *"Kiểm soát/chi phí AI thế nào?"* → Có **AI Observability**: mọi phiên AI được trace (model, độ trễ, token/chi phí, lỗi, feedback), và **bật/tắt từng tính năng AI** không cần deploy.
- *"Sản phẩm chạy gì?"* → Backend Go + Postgres, frontend React, AI dùng DeepSeek (có thể đổi provider).
