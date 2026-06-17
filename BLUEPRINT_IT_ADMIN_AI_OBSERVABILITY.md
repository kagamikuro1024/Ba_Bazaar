# BLUEPRINT / TIP — IT ADMIN + AI OBSERVABILITY CONSOLE
### BA Bazaar · mapped to the real codebase (Go API + React web + Prisma schema)

> This is an implementation blueprint (Task Instruction Pack), **not code yet**. It translates the generic plan into this repo's actual stack and patterns, flags mismatches, and breaks the work into buildable phases. Build phase-by-phase; run `go build ./... && go test ./...` and `pnpm typecheck && pnpm build` after each.

---

## 0. Stack reality check (read first)

| Plan assumes | This repo actually is | Consequence |
|---|---|---|
| Generic TS backend, Prisma everywhere | **Live API = Go** (`apps/api/cmd/api/*.go`, `go run ./cmd/api`), raw SQL via `pgx`. Prisma (`apps/api/prisma`) owns the **schema + migrations**; the TS server (`src/`) is the secondary `dev:node` path. | New tables/enums → **Prisma migration**; new endpoints/queries → **Go handlers with raw SQL**. Keep both in sync. |
| `role` is a string | `UserRole` is a **Prisma enum** `{BA_MANAGER, PM_PO, BA, ADMIN}` (DB enum) **and** a TS union in `apps/web/src/lib/api.ts`. | Adding `IT_ADMIN` = enum migration (`ALTER TYPE`) **+** TS union edit **+** `roleHomePaths` Record edit (compile-enforced). |
| Users can be disabled/enabled | `users` table has **no status/disabled column** (`id, full_name, email, role, password_hash, avatar_url, last_login_at, created_at, updated_at`). | Add `status` (or `disabled_at`) to `users` — required for User Management. |
| `audit_logs` is generic | Exists: `audit_logs(id, actor_id, action, target_type, target_id uuid, old_value json, new_value json, result, created_at)`. `result` enum = `{SUCCESS, DENIED}` only. Helper `app.createAuditLog(ctx, actorID, action, targetType, targetID, result, old, new)`. **No `actor_role`, no IP/UA.** `target_id` is **NOT NULL uuid**. | Extend `AuditResult` with `FAILURE`; add `actor_role` + optional `ip`/`user_agent`; relax `target_id` to nullable text (feature-flag keys aren't uuids). |
| RBAC middleware groups | chi router, **flat `/api`**, every handler calls `app.currentUser(r)` then checks role inline (e.g. `canApproveBooking(user.Role)`). No role middleware. | Add a small `requireRole(...)` middleware for the `/api/admin` sub-router (cleaner than 30 inline checks) — see §4. |
| DetailDrawer component | No Drawer; there is `components/ui/modal.tsx` + a full table kit (`DataTable, DataToolbar, QuickTabs, AdvancedFilter, ActiveFilterChips, Pagination, TableSearch, StatCard, PageHeader, States`). | Reuse the kit; use `Modal` as the "detail drawer" (or add a thin `Drawer` later). |

**AI features that exist today (to instrument in Phase 2):**
- AI Suggest BA → `recommendations.go` / `recommendations_handler.go` (`GET /api/ba/recommendations`)
- Extract PRD/tags to Skill → `tag_extraction_handler.go` (`POST /api/tags/extract`)
- LLM summaries (Dashboard / Action Center / My Schedule / Reports) → `*_llm_summary_handler.go`, shared `llm_client.go` + `llm_summary.go`
- There is **no chatbot yet** — "PM/PO Chatbot" / "BA Manager Chatbot" in the plan are future; instrument them when built (the schema already supports them via `feature_name`).

---

## 1. Architectural decisions (locked per your answers)

1. **New role `IT_ADMIN`** (separate from `ADMIN`). `ADMIN` stays as-is (support). Seed one `it-admin@ba-bazaar.local`.
2. **Schema via Prisma migration**, data access via **Go raw SQL** (match existing handlers). Mirror every new model in `schema.prisma` so `prisma migrate` and the TS side stay valid.
3. **RBAC**: backend `requireRole("IT_ADMIN")` middleware on an `/api/admin` chi sub-router; frontend `RequireRole roles={['IT_ADMIN']}` + role-gated `navigation[]`. **Never** rely on hidden UI alone.
4. **Reuse the existing component kit**; `Modal` for detail views. No new AppShell.
5. **Audit everything** through the existing `createAuditLog` (extended). One write per admin mutation.
6. **Feature flags gate AI at the entry handler** (server-side), not just the UI.

---

## 2. RBAC matrix (concrete)

| Capability | IT_ADMIN | ADMIN (legacy) | BA_MANAGER | PM_PO | BA |
|---|---|---|---|---|---|
| `/admin/*` pages + `/api/admin/*` | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage users / roles / reset pw | ✅ | ❌ | ❌ | ❌ | ❌ |
| View audit logs (system-wide) | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI observability (sessions/tools/errors/feedback) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Toggle AI feature flags / AI settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approve / assign / create booking | ❌ | ❌ | ✅ | create only | ❌ |
| View reports | ✅ (read) | ✅ | ✅ | limited | ❌ |
| Own schedule | ❌ | ❌ | ❌ | ❌ | ✅ |

> IT_ADMIN is **technical/ops**, not a booking operator. Keep it out of the daily booking flow.

**Guardrails (enforce server-side):**
- Cannot change your own role; cannot disable the **last** active `IT_ADMIN`.
- Only `IT_ADMIN` may grant `IT_ADMIN`. Non-admins promoting to admin → `403` + `DENIED` audit.
- Every role change / disable / enable / reset / flag toggle / setting change → `audit_logs`.

---

## 3. Data model

### 3.1 Changes to existing models (`apps/api/prisma/schema.prisma` + migration)

```prisma
enum UserRole {
  BA_MANAGER
  PM_PO
  BA
  ADMIN
  IT_ADMIN          // NEW
}

enum AuditResult {
  SUCCESS
  DENIED
  FAILURE           // NEW (plan wants success/failed)
}

enum UserStatus {    // NEW
  ACTIVE
  DISABLED
}

model User {
  // ...existing fields...
  status        UserStatus  @default(ACTIVE)   // NEW
  // optional: disabled_at DateTime?            // alternative to status
}

model AuditLog {
  // ...existing fields...
  actor_role    String?     // NEW — denormalized for fast filtering
  ip_address    String?     // NEW (optional)
  user_agent    String?     // NEW (optional)
  // relax target_id to text-nullable so non-uuid targets (flag keys) work:
  // target_id  String?     // was: String @db.Uuid (NOT NULL)
}
```

Migration SQL sketch (`prisma/migrations/<ts>_it_admin_ai_observability/migration.sql`):

```sql
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'IT_ADMIN';
ALTER TYPE "AuditResult" ADD VALUE IF NOT EXISTS 'FAILURE';
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE','DISABLED');
ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" TEXT, ADD COLUMN "ip_address" TEXT, ADD COLUMN "user_agent" TEXT;
ALTER TABLE "audit_logs" ALTER COLUMN "target_id" DROP NOT NULL;     -- if keeping uuid, instead add target_key TEXT
-- + the new AI tables below
```
> Note: Postgres can't add enum values inside the same tx as their use; keep enum `ALTER TYPE` in its own migration step if `prisma migrate` complains.

### 3.2 New AI observability tables

All ids `uuid` default, all timestamps `timestamptz`, FKs `ON DELETE CASCADE` to `ai_sessions` where noted. Add matching Prisma models (`@@map`) so the TS schema stays valid.

```prisma
model AiSession {
  id                String   @id @default(uuid()) @db.Uuid
  user_id           String?  @db.Uuid
  user_role         String
  feature_name      String          // see §3.3 enum-as-string
  entry_point       String?
  status            String          // SUCCESS|FAILED|CANCELLED|NEEDS_USER_INPUT|PARTIAL_SUCCESS
  model_name        String?
  prompt_version    String?
  created_request_id String? @db.Uuid
  started_at        DateTime @default(now())
  ended_at          DateTime?
  duration_ms       Int?
  error_count       Int      @default(0)
  token_input       Int?            // for cost/usage
  token_output      Int?
  estimated_cost    Decimal? @db.Decimal(10,4)
  @@index([feature_name]); @@index([status]); @@index([started_at]); @@index([user_id])
  @@map("ai_sessions")
}

model AiMessage {
  id                String   @id @default(uuid()) @db.Uuid
  session_id        String   @db.Uuid
  sender            String          // USER|ASSISTANT|SYSTEM|TOOL
  content           String          // raw (mask before store if sensitive)
  sanitized_content String?         // masked copy actually shown in console
  created_at        DateTime @default(now())
  @@index([session_id]); @@map("ai_messages")
}

model AiExtraction {
  id              String   @id @default(uuid()) @db.Uuid
  session_id      String   @db.Uuid
  extraction_type String          // BOOKING_INTENT|PRD_TO_SKILL|SUMMARY_CONTEXT
  raw_input       String
  extracted_json  Json
  missing_fields  Json?
  confidence      Float?
  created_at      DateTime @default(now())
  @@index([session_id]); @@map("ai_extractions")
}

model AiToolCall {
  id            String   @id @default(uuid()) @db.Uuid
  session_id    String   @db.Uuid
  tool_name     String
  feature_name  String?
  input_json    Json
  output_json   Json?
  status        String          // SUCCESS|FAILED
  latency_ms    Int?
  retry_count   Int      @default(0)
  error_message String?
  model_name    String?
  prompt_version String?
  created_at    DateTime @default(now())
  @@index([session_id]); @@index([tool_name]); @@index([status]); @@map("ai_tool_calls")
}

model AiError {
  id           String   @id @default(uuid()) @db.Uuid
  session_id   String?  @db.Uuid
  feature_name String
  error_type   String          // MODEL_ERROR|PARSING_ERROR|VALIDATION_ERROR|TOOL_CALL_FAILED|CAPACITY_CONFLICT|PERMISSION_DENIED|TIMEOUT|EMPTY_SUGGESTION|PROMPT_GUARDRAIL_TRIGGERED|UNKNOWN
  severity     String          // LOW|MEDIUM|HIGH|CRITICAL
  message      String
  stack_trace  String?
  status       String   @default("OPEN")  // OPEN|RESOLVED
  note         String?
  resolved_by  String?  @db.Uuid
  resolved_at  DateTime?
  created_at   DateTime @default(now())
  @@index([feature_name]); @@index([severity]); @@index([status]); @@map("ai_errors")
}

model AiFeedback {
  id           String   @id @default(uuid()) @db.Uuid
  session_id   String?  @db.Uuid
  user_id      String?  @db.Uuid
  feature_name String
  rating       String          // HELPFUL|NOT_HELPFUL
  category     String?         // WRONG_BA|WRONG_SKILL|WRONG_DATE|WRONG_CAPACITY|TOO_VAGUE|MISSING_DATA|OTHER
  comment      String?
  created_at   DateTime @default(now())
  @@index([feature_name]); @@index([rating]); @@map("ai_feedback")
}

model AiFeatureFlag {
  id          String   @id @default(uuid()) @db.Uuid
  key         String   @unique     // ai_suggest_ba_enabled, ...
  name        String
  description String?
  enabled     Boolean  @default(true)
  environment String   @default("all")
  updated_by  String?  @db.Uuid
  updated_at  DateTime @updatedAt
  @@map("ai_feature_flags")
}

model AiSetting {
  id          String   @id @default(uuid()) @db.Uuid
  key         String   @unique
  value       String
  description String?
  updated_by  String?  @db.Uuid
  updated_at  DateTime @updatedAt
  @@map("ai_settings")
}
```

### 3.3 Enum-as-string conventions (Go side)
Keep these as **string constants in Go** (not DB enums) so adding features doesn't need a migration:
- `feature_name`: `AI_SUGGEST_BA`, `AI_PRD_SKILL`, `AI_PMPO_CHATBOT`, `AI_BAMGR_CHATBOT`, `AI_DASHBOARD_SUMMARY`, `AI_ACTION_CENTER_SUMMARY`, `AI_REPORT_SUMMARY`, `AI_MYSCHEDULE_SUMMARY`.
- `tool_name`: `extract_booking_intent, extract_prd_to_skill, suggest_ba, check_capacity_conflict, create_pending_request, generate_dashboard_summary, generate_action_center_summary, generate_report_summary`.
- Feature-flag keys: `ai_suggest_ba_enabled, ai_prd_skill_extraction_enabled, ai_pmpo_chatbot_enabled, ai_ba_manager_chatbot_enabled, ai_dashboard_summary_enabled, ai_report_summary_enabled, ai_observability_enabled`.

### 3.4 New audit actions (string values for `audit_logs.action`)
`USER_CREATED, USER_ROLE_CHANGED, USER_DISABLED, USER_ENABLED, PASSWORD_RESET, AI_FEATURE_TOGGLED, AI_PROMPT_VERSION_CHANGED, AI_MODEL_CHANGED, AI_SETTING_CHANGED, AI_ERROR_RESOLVED, BOOKING_CREATED_BY_AI, BOOKING_CREATE_FAILED_BY_AI, AI_TOOL_CALL_FAILED, AI_SESSION_FLAGGED, SYSTEM_SETTING_CHANGED`.

---

## 4. Backend (Go) — RBAC middleware + file map

### 4.1 Role guard middleware (new)
Add to `router.go` (or a new `admin_middleware.go`). chi supports `r.Use` inside a sub-router. `currentUser` already reads the auth context.

```go
func (app *App) requireRole(roles ...string) func(http.Handler) http.Handler {
    allowed := map[string]bool{}
    for _, r := range roles { allowed[r] = true }
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            user, err := app.currentUser(r)
            if err != nil { writeJSON(w, 401, map[string]string{"message": "Authentication required."}); return }
            if !allowed[user.Role] {
                _ = app.createAuditLog(r.Context(), user.ID, "ACCESS_DENIED", "AdminRoute", r.URL.Path, "DENIED", nil, nil)
                writeJSON(w, 403, map[string]string{"message": "IT Admin role required."}); return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

Wire an `/api/admin` group in `Routes()`:

```go
r.Route("/api", func(r chi.Router) {
    // ...existing routes...
    r.Route("/admin", func(r chi.Router) {
        r.Use(app.requireRole("IT_ADMIN"))
        r.Get("/users", app.handleAdminUsersList)
        r.Post("/users", app.handleAdminUserCreate)
        r.Patch("/users/{id}", app.handleAdminUserUpdate)
        r.Patch("/users/{id}/role", app.handleAdminUserRole)
        r.Patch("/users/{id}/disable", app.handleAdminUserDisable)
        r.Patch("/users/{id}/enable", app.handleAdminUserEnable)
        r.Post("/users/{id}/reset-password", app.handleAdminUserResetPassword)
        r.Get("/audit-logs", app.handleAdminAuditLogs)
        r.Get("/audit-logs/{id}", app.handleAdminAuditLogByID)
        r.Get("/overview", app.handleAdminOverview)              // admin dashboard
        r.Get("/ai/overview", app.handleAdminAIOverview)
        r.Get("/ai/sessions", app.handleAdminAISessions)
        r.Get("/ai/sessions/{id}", app.handleAdminAISessionDetail)
        r.Get("/ai/tool-calls", app.handleAdminAIToolCalls)
        r.Get("/ai/errors", app.handleAdminAIErrors)
        r.Patch("/ai/errors/{id}/resolve", app.handleAdminAIErrorResolve)
        r.Get("/ai/feedback", app.handleAdminAIFeedback)
        r.Get("/ai/feature-flags", app.handleAdminAIFlags)
        r.Patch("/ai/feature-flags/{key}", app.handleAdminAIFlagToggle)
        r.Get("/ai/settings", app.handleAdminAISettings)
        r.Patch("/ai/settings/{key}", app.handleAdminAISettingUpdate)
    })
})
```

### 4.2 New Go files (follow existing handler style: `app.currentUser`, `writeJSON`, `app.DB.Pool`, `parsePagination`)
| File | Purpose |
|---|---|
| `admin_middleware.go` | `requireRole`, shared admin helpers |
| `admin_user_handlers.go` | users CRUD/role/disable/enable/reset (+ guardrails §2) |
| `admin_audit_handlers.go` | audit list/detail with filters (reuse `audit_logs`) |
| `admin_overview_handler.go` | `/admin/overview` system + AI health counts |
| `admin_ai_handlers.go` | sessions/tool-calls/errors/feedback/overview reads + error resolve |
| `admin_ai_settings_handlers.go` | feature flags + settings read/patch (+ audit) |
| `ai_logging.go` | **instrumentation helpers** (see §6) used by AI features |
| `ai_feature_flags.go` | `isAIFeatureEnabled(ctx, key) bool` + cached read |
| `seed.go` (edit) | seed `IT_ADMIN` user, default feature flags + settings |

### 4.3 Endpoint contracts (shape matches existing `writeJSON` lists)
- **List endpoints** mirror `handleBAList`: support `?page&page_size` (reuse `parsePagination`), `?search`, plus per-resource filters; return either a bare array or `{items,total,page,page_size,total_pages}` when paginated.
- `GET /api/admin/users` → filters `role,status,search`; row `{id,full_name,email,role,status,last_login_at,created_at}`.
- `PATCH /api/admin/users/{id}/role` body `{role}` → guardrails, then `USER_ROLE_CHANGED` audit with old/new role.
- `POST /api/admin/users/{id}/reset-password` → returns a one-time temp password (or triggers email later); audit `PASSWORD_RESET` (never log the password).
- `GET /api/admin/ai/overview` → the §9.1 summary cards (counts computed from `ai_sessions/ai_tool_calls/ai_errors/ai_feedback` for "today" + selected range) **and** a per-feature health array (§9.3) joined with `ai_feature_flags`.
- `GET /api/admin/ai/sessions/{id}` → session + joined `ai_messages` (sanitized), `ai_tool_calls`, `ai_extractions`, `ai_errors`, `ai_feedback`, and `created_request_id` link.
- `PATCH /api/admin/ai/errors/{id}/resolve` body `{note?}` → set status RESOLVED + `AI_ERROR_RESOLVED` audit.
- `PATCH /api/admin/ai/feature-flags/{key}` body `{enabled}` → update + `AI_FEATURE_TOGGLED` audit (old/new).

---

## 5. Frontend (React) — file map + wiring

### 5.1 Type + routing edits (compile-enforced ripple)
| File | Edit |
|---|---|
| `apps/web/src/lib/api.ts` | `UserRole = ... | 'IT_ADMIN'`; add types for admin payloads (User row, AuditLog, AiSession, AiToolCall, AiError, AiFeedback, FeatureFlag, AiSetting). |
| `apps/web/src/auth/routes.ts` | add `IT_ADMIN: '/admin/dashboard'` to `roleHomePaths` (Record is compile-checked). |
| `apps/web/src/App.tsx` | add `/admin/*` routes wrapped in `<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}>...`. |
| `apps/web/src/components/LayoutShell.tsx` | add admin items to `navigation[]` with `roles: ['IT_ADMIN']` (icons from `lucide-react`). They auto-hide for everyone else (filter at line ~238). |

### 5.2 New pages (reuse the kit — no new layout)
| Route | File | Reuses |
|---|---|---|
| `/admin/dashboard` | `pages/admin/AdminDashboardPage.tsx` | `StatCard`, `AISummaryCard`(opt), recent-errors + recent-audit mini tables |
| `/admin/users` | `pages/admin/AdminUsersPage.tsx` | `DataTable, DataToolbar, QuickTabs, AdvancedFilter, ActiveFilterChips, Pagination, TableSearch`, `Modal` (create/edit role/reset) |
| `/admin/audit-logs` | `pages/admin/AdminAuditLogsPage.tsx` | same table kit + `Modal` detail |
| `/admin/ai/observability` | `pages/admin/AIObservabilityPage.tsx` | `StatCard` cards + feature-health `DataTable` + toggles |
| `/admin/ai/sessions` | `pages/admin/AISessionsPage.tsx` | table + `Modal` session detail (transcript, tool timeline, extracted JSON, request link) |
| `/admin/ai/tool-calls` | `pages/admin/AIToolCallsPage.tsx` | table + `Modal` (full input/output JSON) |
| `/admin/ai/errors` | `pages/admin/AIErrorsPage.tsx` | table + severity `Badge` + resolve action |
| `/admin/ai/feedback` | `pages/admin/AIFeedbackPage.tsx` | table |
| `/admin/ai/feature-flags` | `pages/admin/AIFeatureFlagsPage.tsx` | toggle list + history |
| `/admin/ai/settings` | `pages/admin/AISettingsPage.tsx` | form (model/provider/prompt version/temp/etc.) |

> Use `ManagerInboxPage.tsx` as the reference implementation for the table pattern (quick tabs + search + filter popover + active chips + sort + pagination + row actions).

---

## 6. AI logging instrumentation (Phase 2 — the heart of observability)

### 6.1 Helper design (`ai_logging.go`)
A tiny session recorder threaded through each AI entry handler:

```go
type aiSession struct{ app *App; id, feature, role string; userID *string; start time.Time }

func (app *App) beginAISession(ctx, userID *string, role, feature, entryPoint, model, promptVer string) *aiSession // INSERT ai_sessions(status=NEEDS_USER_INPUT)
func (s *aiSession) logMessage(ctx, sender, content string)                     // INSERT ai_messages (+ mask -> sanitized_content)
func (s *aiSession) logExtraction(ctx, typ, rawInput string, extracted any, missing []string, conf float64)
func (s *aiSession) logToolCall(ctx, tool string, input any, run func() (any, error)) error // times it, INSERTs ai_tool_calls, on err also ai_errors + AI_TOOL_CALL_FAILED audit, bumps error_count
func (s *aiSession) logError(ctx, errType, severity, msg string, err error)
func (s *aiSession) finish(ctx, status string, createdRequestID *string, tokIn, tokOut int) // UPDATE ai_sessions ended_at/duration/status/tokens
```
Keep logging **best-effort** (never block/fail the user request if a log insert fails — wrap in goroutine or ignore error, like existing notification inserts).

### 6.2 Where to hook each existing feature
| Feature | File / entry | Log |
|---|---|---|
| AI Suggest BA | `recommendations_handler.go` `handleRecommendations` | session(`AI_SUGGEST_BA`); extraction of required skills; `suggest_ba` + `check_capacity_conflict` tool calls; suggestions + scores in output_json; `EMPTY_SUGGESTION` error if none; finish SUCCESS/FAILED; capture selected BA + feedback later |
| PRD → Skill | `tag_extraction_handler.go` `handleTagExtraction` | session(`AI_PRD_SKILL`); `extract_prd_to_skill` tool call; extraction(`PRD_TO_SKILL`, raw input, extracted skills/domains, confidence, missing); `PARSING_ERROR` on bad JSON |
| Dashboard/AC/Report/MySchedule summaries | `*_llm_summary_handler.go` (+ `llm_summary.go`) | session(`AI_*_SUMMARY`); `generate_*_summary` tool call with latency/model/prompt version; `MODEL_ERROR`/`TIMEOUT` on failure; token usage if `llm_client.go` returns it |
| Future chatbots | new handlers | session(`AI_PMPO_CHATBOT`/`AI_BAMGR_CHATBOT`); `ai_messages` per turn; `extract_booking_intent` + `create_pending_request` tool calls; link `created_request_id` |

### 6.3 Feature-flag gating (server-side)
At the top of each AI entry handler: `if !app.isAIFeatureEnabled(ctx, "ai_suggest_ba_enabled") { writeJSON(w, 403/200, {disabled:true}) }`. Frontend also reads `/api/admin/ai/feature-flags` (or a public `/api/ai/feature-flags` projection) to hide disabled AI affordances. Toggling a flag writes `AI_FEATURE_TOGGLED` audit.

---

## 7. Sensitive-data masking (§20.3)
- Central `maskSensitive(text) string` in `ai_logging.go`: redact emails, phones, anything matching `password|token|secret|api[_-]?key|authorization|bearer`. Store **raw in `content`** only if policy allows; always compute `sanitized_content` and **show only sanitized** in the console.
- Never log: password values, reset tokens, JWT/refresh tokens, API keys. `PASSWORD_RESET` audit stores no secret.
- Private notes already gated by `canReadPrivateNotes` — don't surface them in AI logs unless needed for support.
- Add an `ai_observability_enabled` master flag; when off, console shows a notice and reads return empty.

---

## 8. Phased rollout (build + verify per phase)

### Phase 1 — IT Admin foundation (no AI yet)
**Backend:** migration (UserRole `IT_ADMIN`, `UserStatus`, `users.status`, `AuditResult.FAILURE`, `audit_logs.actor_role/ip/ua`, relax `target_id`); `admin_middleware.go` (`requireRole`); `admin_user_handlers.go`; `admin_audit_handlers.go`; `admin_overview_handler.go`; wire `/api/admin` group; seed `IT_ADMIN` user; extend `createAuditLog` to capture `actor_role`.
**Frontend:** `api.ts` (`IT_ADMIN` + types); `auth/routes.ts`; `App.tsx` (`/admin/dashboard|/admin/users|/admin/audit-logs`); `LayoutShell` nav; `AdminDashboardPage`, `AdminUsersPage`, `AdminAuditLogsPage`.
**Done when:** IT_ADMIN logs in, lands on `/admin/dashboard`, manages users/roles, sees audit logs; other roles get 403 on `/api/admin/*` and "Access denied" on `/admin/*`.

### Phase 2 — AI observability data model + logging
Add the 8 AI tables (migration + Prisma models + Go insert/read). Build `ai_logging.go` + `ai_feature_flags.go`. Instrument **AI Suggest BA** and **PRD→Skill** first (§6.2). Verify rows land in `ai_sessions/ai_tool_calls/ai_extractions/ai_errors`.
**Done when:** using Suggest BA / PRD extract creates session + tool-call (+ error on failure) rows; IT_ADMIN can read raw rows via API.

### Phase 3 — AI observability UI
`AIObservabilityPage` (cards + feature-health table), `AISessionsPage` (+ detail Modal: transcript, tool timeline, extracted JSON, request link), `AIToolCallsPage`, `AIErrorsPage` (resolve), `AIFeedbackPage`. Filters/search/sort/pagination via the kit.
**Done when:** IT_ADMIN can trace any AI run end-to-end and resolve errors.

### Phase 4 — Feature flags + settings
`ai_feature_flags` + `ai_settings` seeded; `AIFeatureFlagsPage` + `AISettingsPage`; server-side gating in every AI entry handler; `AI_FEATURE_TOGGLED`/`AI_SETTING_CHANGED` audit; optional public flag projection for the FE to hide disabled AI.
**Done when:** toggling `ai_suggest_ba_enabled` off makes Suggest BA unavailable for PM/PO + Manager; re-enabling restores it; each toggle is audited.

### Phase 5 — Hardening / QA
RBAC tests, audit coverage, masking tests, feature-flag on/off, perf with many logs (indexes in §3), add `ai_feedback` capture UI on AI responses (Helpful / Not helpful + reason).

---

## 9. Required tests (make concrete; Go `httptest` + a thin FE smoke)

**RBAC (§23.1, §23.5):**
- `IT_ADMIN` → `/admin/dashboard` 200; `/api/admin/ai/sessions` 200.
- `BA_MANAGER`/`PM_PO`/`BA` → `/api/admin/*` **403** + `DENIED` audit; `/admin/*` shows Access denied.
**User mgmt (§23.2):** create/role-change/disable/enable each write the right `audit_logs` row; cannot disable last `IT_ADMIN`; cannot self-demote; non-admin promote → 403.
**AI observability (§23.3):** Suggest BA → 1 `ai_sessions` + ≥1 `ai_tool_calls`; PRD extract → `ai_extractions`; forced tool failure → `ai_errors`(OPEN) + `error_count`++; session detail joins everything; resolve sets RESOLVED + audit.
**Feature flags (§23.4):** flag off → entry handler blocks (server) and UI hides; toggle → `AI_FEATURE_TOGGLED` audit.
**Masking (§23.5):** seed a message containing a fake token/email → `sanitized_content` redacts it; console shows sanitized only.

---

## 10. Acceptance criteria (from plan §24, mapped)
Role `IT_ADMIN` ✓ · Admin sidebar (role-gated) ✓ · User Mgmt ✓ · Audit Logs ✓ · AI Observability dashboard/sessions/tool-calls/errors/feedback ✓ · Feature Flags + Settings ✓ · Suggest BA + PRD + summaries (+ future chatbots) logged ✓ · RBAC on **all** `/admin` routes & `/api/admin` APIs ✓ · Audit on admin actions ✓ · Sensitive-data masking ✓ · Reuses existing component kit ✓.

---

## 11. Open decisions to confirm before Phase 1
1. **Reset password**: return a temp password in the API response (simple) vs send email (needs mailer)? Blueprint assumes temp-password-in-response for MVP.
2. **`target_id`**: relax to nullable text (simplest for flag keys) vs keep uuid + add `target_key text`? Blueprint assumes relax-to-text.
3. **Token/cost**: does `llm_client.go` expose token usage? If not, `token_*`/`estimated_cost` stay null until the client returns usage.
4. **Public AI-flag read**: expose `GET /api/ai/feature-flags` (projection, any authed user) so the FE can hide disabled AI without admin rights — recommended.
5. Keep the **TS `src/` backend** in sync, or is it dead? If dead, only Prisma schema + Go matter (confirm so we don't double-maintain handlers).

---

## 12. Completion report template (fill during build)
```md
# COMPLETION REPORT — IT ADMIN + AI OBSERVABILITY (Phase X)
## Status: DONE / PARTIAL / BLOCKED
## Summary: ...
## Files Changed: | File | Change |
## Role / RBAC: | Test | Expected | Result |
| IT_ADMIN /admin | Allow | |
| BA_MANAGER /api/admin/* | 403 + DENIED audit | |
| PM_PO /admin/* | Access denied | |
## Admin Features: | Feature | Result | Evidence | (Dashboard, Users, Audit, Settings)
## AI Observability: | Feature | Result | Evidence | (Overview, Sessions, Messages, Extractions, Tool Calls, Errors, Feedback, Flags)
## AI Features Covered: | Feature | Logging | Observability | Toggle | (Suggest BA, PRD→Skill, PM/PO Chatbot, BA Mgr Chatbot)
## Commands: | pnpm lint | typecheck | build | test | go build | go test | db:migrate | db:seed |
## Remaining Issues: | Issue | Severity | Recommendation |
```

---

### Appendix — quick reference to real anchors
- Router: `apps/api/cmd/api/router.go` (`Routes()`, flat `/api`). Add `/api/admin` group here.
- Auth/role: `apps/api/cmd/api/auth.go` (`currentUser`, role normalize, default `BA_MANAGER`). Role checks pattern: `booking_handlers.go` (`canApproveBooking`, etc.).
- Audit: `createAuditLog(ctx, actorID, action, targetType, targetID, result, old, new)`; table `audit_logs`.
- Users/seed: `seed.go` `insertUser(...)`; existing `ADMIN` seed `admin@ba-bazaar.local`.
- AI entry points: `recommendations_handler.go`, `tag_extraction_handler.go`, `*_llm_summary_handler.go`, `llm_client.go`, `llm_summary.go`.
- Schema: `apps/api/prisma/schema.prisma` + `prisma/migrations/*`. Enums at top; `User`/`AuditLog` models; `@@map` to snake_case tables.
- FE routing/guards: `App.tsx` (`ProtectedPage`, `RequireRole`, `LayoutShell`), `auth/routes.ts` (`roleHomePaths`), `components/LayoutShell.tsx` (`navigation[]`), `lib/api.ts` (`UserRole`).
- FE table kit: `components/{DataTable,DataToolbar,QuickTabs,AdvancedFilter,ActiveFilterChips,Pagination,TableSearch,StatCard,PageHeader,States,Badges}.tsx`, `components/ui/modal.tsx`. Reference page: `ManagerInboxPage.tsx`.
