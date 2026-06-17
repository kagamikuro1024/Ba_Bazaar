# 🛠️ TECH Q&A — BA Bazaar (bỏ túi khi demo)

> Trả lời ngắn gọn, đúng theo code. Phần **Chatbot / LangGraph / Guardrail / Tool** để lên đầu vì hay bị hỏi nhất.

---

## ⚙️ Trước khi demo chatbot — kiểm tra nhanh
- Chatbot là **một service Python riêng** (`apps/ai`, FastAPI + LangGraph), chạy độc lập với `pnpm dev`. Phải **bật service đó** (uvicorn, mặc định cổng `:8000`) thì nút **Chat (FAB góc dưới phải)** mới hoạt động.
- Service cần env: `DEEPSEEK_API_KEY`, và `api_base_url` trỏ về Go API (để gọi tool + gửi log). Hỏi bạn-làm-phần-này lệnh chạy chính xác (đại loại `cd apps/ai && uvicorn ba_chat.server:app --port 8000`).
- Nếu service AI **không chạy**: web vẫn chạy bình thường, chỉ là nút chat không phản hồi — đừng demo chat, demo phần khác.

---

## 🤖 CHATBOT / LANGGRAPH

**Q: Chatbot xây bằng gì?**
> Một microservice **Python** dùng **LangGraph** (StateGraph) + **FastAPI**, trả lời **streaming qua SSE** (token-by-token). React chỉ render Markdown. Tách riêng khỏi backend Go vì LangGraph/Guardrails thuộc hệ sinh thái Python — deploy & scale độc lập.

**Q: Luồng xử lý (graph) ra sao?**
> Vào **`router`** phân loại ý định → 2 nhánh:
> - **Analyze (read-only):** `retrieve_metrics → summarize_metrics → END` — tóm tắt số liệu đội/dự án.
> - **Tạo booking (multi-turn):** `extract_slots → validate_slots` → nếu thiếu thông tin `ask_missing` (kết thúc lượt, chờ user) → đủ thì `pick_write_mode → fetch_recommendations → simulate_capacity → confirm`. Chỉ khi user xác nhận "yes" mới tới **`submit_booking`** (node ghi dữ liệu duy nhất).
> Có thêm `side_chat` (trả lời lạc đề) và `cancelled` (huỷ).

**Q: Bot nhớ hội thoại nhiều lượt thế nào?**
> LangGraph **checkpointer theo `thread_id`** (hiện `MemorySaver` in-memory; production swap sang **PostgresSaver** để chia sẻ state giữa nhiều instance). Mỗi lượt nhớ các "slot" đã điền (project, ngày, capacity, BA...).

**Q: Lỗi/timeout thì sao?**
> Mỗi node IO có **RetryPolicy** (3 lần, backoff + jitter) cho lỗi tạm (timeout, 5xx, DeepSeek hiccup). Mọi node bọc trong **`safe_node`** → hết retry vẫn trả một câu trả lời thân thiện thay vì sập stream. **Riêng `submit_booking` KHÔNG retry** — tránh tạo booking trùng.

---

## 🛡️ GUARDRAIL (hay bị hỏi)

**Q: Có guardrail chống gì, đặt ở đâu?**
> **2 lớp:**
> 1. **NeMo Guardrails** (`nemoguardrails`, config-driven trong `guardrails_config`).
> 2. **Bộ lọc regex tự viết**, chạy **trước khi xử lý input** và **sau khi có output**:
>    - **Input:** chặn *prompt injection* ("ignore previous instructions", "show me your system prompt"), *malicious intent* ("drop the database", "rm -rf"), *đòi dữ liệu nhạy cảm* ("give me the api key/token"). Bị chặn → trả lời lịch sự, kéo user về đúng nghiệp vụ.
>    - **Output:** quét và **chặn nếu lộ secret** (API key, token kiểu `sk-...`, `ghp_...`, bearer token).

**Q: Chatbot có thể tự ý xoá/sửa dữ liệu không?**
> **Không.** Chỉ node `submit_booking` ghi dữ liệu, và phải qua **3 cổng độc lập**: (1) router phân loại là `create_booking`, (2) `confirmed=True` từ chính câu "yes/đồng ý/ok" của user, (3) kiểm lại điều kiện trước cạnh tới submit. Cộng thêm: **không retry write**, và mọi thao tác đi qua **Go API có RBAC + validation** (kể cả **chốt chặn overbook**).

**Q: Tạo booking qua chat có vượt 100% (overbook) được không?**
> **Không.** Tool tạo booking gọi đúng endpoint Go `POST /api/bookings/request` (hoặc `/direct`) — **cùng validation** như web, nên cũng bị **chặn duyệt >100%**. Chat không phải "cửa sau".

---

## 🔧 TOOLS

**Q: Chatbot dùng "tool" gì? Có truy cập DB trực tiếp không?**
> **Không truy cập DB trực tiếp.** Tools **map 1:1 với Go API**, gọi qua HTTP:
> - **Read:** lấy metrics/dashboard summary, **`get_recommendations`** (Suggest BA), **`range_check`** (kiểm capacity/conflict).
> - **Write:** **`create_booking_request`** (PM/PO hoặc Manager), **`create_booking_direct`** (chỉ Manager, cần `ba_id`).
> Mỗi tool call tự được ghi lại (tên = `METHOD /path`, input/output JSON, latency, status) qua một **ContextVar**, rồi gửi về observability.

**Q: Bot lấy quyền ở đâu?**
> Nó nhận **access token của chính user** (Bearer) và **dùng token đó cho mọi tool call** → Go enforce RBAC. Bot **không có quyền cao hơn user** đang chat (vd PM/PO không thể direct-book hay approve).

---

## 📊 OBSERVABILITY & CHI PHÍ

**Q: Theo dõi chatbot/AI thế nào?**
> Sau mỗi lượt chat, service Python **POST log về Go** `/api/ai/chat/log`. Go ghi vào **`ai_sessions` / `ai_messages` / `ai_tool_calls` / `ai_errors`**. IT Admin xem ở **AI Observability** (sessions, tool calls, lỗi, chi phí, feedback). Tool call FAIL tự tạo `ai_errors` + tăng `error_count`.

**Q: Tính chi phí token kiểu gì?**
> Ước lượng **~4 ký tự/token**, nhân giá DeepSeek (**$0.14/1M input, $0.28/1M output**) → `estimated_cost` mỗi phiên. Lưu cả `token_input/output`, `duration_ms`, `model_name`, `prompt_version`.

**Q: Dữ liệu nhạy cảm trong nội dung chat?**
> Trước khi lưu, nội dung được **`maskSensitive`** → console chỉ hiển thị bản đã che (`sanitized_content`). Có cờ **`ai_observability_enabled`** để tắt toàn bộ ghi log nếu cần.

---

## 🏗️ KIẾN TRÚC & BẢO MẬT CHUNG

**Q: Stack tổng thể?**
> **Go** (HTTP API runtime, chi router, SQL thuần qua pgx) là **nguồn sự thật + RBAC + validation**. **React + Vite** cho web. **PostgreSQL**; **Prisma chỉ giữ schema + migrations**. **Python (FastAPI + LangGraph)** cho chatbot. LLM: **DeepSeek** (đổi provider được). AI summary/suggest có **fallback deterministic** khi LLM lỗi.

**Q: Vì sao 3 ngôn ngữ (Go + TS + Python)?**
> Mỗi phần chọn công cụ mạnh nhất: Go cho API hiệu năng cao + chốt nghiệp vụ; React cho UI; Python cho agentic AI (LangGraph + NeMo Guardrails — hệ sinh thái chín nhất). Tách microservice AI giúp scale/deploy độc lập, AI chết cũng không sập app.

**Q: Phân quyền (RBAC) ở đâu?**
> Ở **cả frontend lẫn backend**. Gọi API admin sai vai trò bị **403** (và ghi audit). Chatbot cũng chịu RBAC vì dùng token user. Mọi thao tác quản trị có **audit log** (ai – gì – khi nào – IP – before/after).

**Q: AI có "bịa" số liệu hay tự quyết không?**
> Không. **Summary có trích dẫn** (C1, C2...) chỉ từ facts; **Suggest BA / Extract PRD** chọn từ dữ liệu & bộ kỹ năng chuẩn (không bịa tag); **chatbot** chỉ đọc qua tool và **chỉ ghi sau khi user xác nhận**. Con người luôn là người bấm nút cuối.

**Q: PM/PO chatbot và BA Manager chatbot khác gì?**
> Cùng một graph; phân biệt bằng `feature_name` (`AI_PMPO_CHATBOT` vs `AI_BAMGR_CHATBOT`) theo vai trò, và **khác quyền** (chỉ Manager mới direct-book/approve — do Go enforce).

**Q: Scale & độ bền?**
> FastAPI bất đồng bộ; state in-process (prod dùng PostgresSaver để đa-instance). Retry + timeout cho upstream. Go API scale riêng. Tắt được từng tính năng AI bằng **feature flags** mà không cần deploy.
