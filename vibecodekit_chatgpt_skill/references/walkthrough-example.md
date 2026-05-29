# Walkthrough Example — ChatGPT + Coding Agent Edition

Project: simple task-management REST API.

## Step 1 — SCAN

**Human:** “Chủ thầu, tôi cần build API quản lý task cho team nhỏ, dùng Node.js.”

**ChatGPT / Contractor:** “Bạn có codebase sẵn không?”

**Human:** “Chưa, bắt đầu từ đầu.”

**Contractor → Builder:** Scan empty folder.

**Builder → Scan Report:**

```text
TECH_STACK: Empty project
EXISTING_MODULES: None
GAPS_DETECTED: Everything
ESTIMATED_SIZE: 0
```

## Step 2 — RRI

**Contractor / End User / CHALLENGE:**
“I propose one user role only. OK?”

**Human:** “Không, cần Admin và Member.”

**Contractor / Business Analyst / GUIDED:**
“Task workflow: Todo → In Progress → Done, or more complex?”

**Human:** “Todo → In Progress → Review → Done.”

**Contractor / QA / CHALLENGE:**
“I propose email/password auth, password min 8 chars. OK?”

**Human:** “OK.”

**Contractor / Developer / CHALLENGE:**
“Stack: Express + SQLite + Prisma + JWT. OK?”

**Human:** “OK.”

**Contractor / Operator / CHALLENGE:**
“Local first, deployment deferred. OK?”

**Human:** “OK.”

**RRI Report:**

```markdown
| REQ-ID | Requirement | Priority |
|---|---|---|
| REQ-001 | JWT auth | P0 |
| REQ-002 | Admin and Member roles | P0 |
| REQ-003 | Task CRUD | P0 |
| REQ-004 | 4-state workflow | P0 |
| REQ-005 | Role-based transitions | P1 |
| REQ-006 | Task assignment | P1 |
| REQ-007 | Filtering/search | P2 |
```

## Step 3 — VISION

```markdown
PROJECT: Task Manager API
NATURE: API-only + CRUD/workflow + small team

Architecture:
- Auth module
- User module
- Task module
- Middleware: auth guard, role check
- Data layer: Prisma + SQLite

Tech Stack:
Express + SQLite + Prisma + JWT + bcrypt
```

## Step 4 — BLUEPRINT & CONTRACT

Contractor presents:
- API endpoints.
- DB schema.
- Role rules.
- File structure.
- Requirements mapping.

Human replies: `APPROVED`.

Contractor presents Contract.
Human replies: `CONFIRM`.

## Step 5 — TASK GRAPH

```text
TIP-001: Scaffold
    └── TIP-002: DB Schema
            ├── TIP-003: Auth
            └── TIP-004: Task CRUD + Workflow
                    └── TIP-005: Role Rules + Assignment
                            └── TIP-006: Verify
```

## Step 6 — BUILD Example

```markdown
# TIP-004: Task CRUD + Workflow

## Context
- Existing auth middleware from TIP-003
- Prisma Task model from TIP-002

## Task
Implement task CRUD and workflow transition endpoints.

## Specifications
- POST /tasks creates task with TODO status.
- GET /tasks lists tasks with filters.
- PATCH /tasks/:id updates fields.
- PATCH /tasks/:id/transition moves status.
- DELETE /tasks/:id soft deletes.
- Allowed workflow: TODO → IN_PROGRESS → REVIEW → DONE.
- Backward transition blocked unless Admin rule in TIP-005.

## Acceptance Criteria
Given authenticated user
When POST /tasks with valid title
Then task is created with TODO and 201 response

Given task in TODO
When transition to IN_PROGRESS
Then response is 200 and status updates

Given task in DONE
When transition to TODO
Then response is 400
```

**Builder Completion Report:**

```markdown
STATUS: DONE

FILES CHANGED:
- Created src/routes/tasks.ts
- Created src/services/taskService.ts
- Modified src/app.ts

TEST RESULTS:
- AC 1 PASS
- AC 2 PASS
- AC 3 PASS

ISSUES:
- SQLite enum not native; used string + validation.

SUGGESTION:
- Add pagination for filtering later.
```

## Step 7 — VERIFY

```markdown
# VERIFY REPORT: Task Manager API

Requirement Coverage:
- Total: 7
- Implemented: 7
- Missing: 0
- Coverage: 100%

Scenario Results:
- Passed: 14
- Failed: 1 minor pagination stress case

Technical Health:
- Build: PASS
- Type errors: 0
- Tests: PASS

Overall: READY with one P2 deferral.
```

## Step 8 — REFINE

Contractor asks:

```text
Choose:
A. Ship as-is, pagination later.
B. Add pagination now.
```

Human chooses A.

Project ships.

## Key Takeaways

1. Human made strategic decisions only.
2. ChatGPT designed and verified.
3. Builder implemented and reported.
4. Every requirement traced to TIPs and tests.
5. Deviations were visible instead of hidden.
