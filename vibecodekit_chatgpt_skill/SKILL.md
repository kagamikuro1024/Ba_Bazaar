---
name: vibecode-kit-chatgpt
description: >
  Vibecode Kit for ChatGPT + coding agents/Codex — General-Purpose AI-Assisted Development Methodology.
  Uses 3 roles: Chủ nhà/Homeowner (human), Chủ thầu/Contractor (ChatGPT), and Thợ thi công/Builder
  (coding agent such as Codex, ChatGPT in coding mode, Cursor, Claude Code, or another implementation agent).
  Workflow: SCAN → RRI → VISION → BLUEPRINT → TASK GRAPH → BUILD → VERIFY → REFINE.
  Use this skill when the user mentions vibecode, Chủ thầu, Thợ thi công, TIP, RRI, Blueprint,
  Completion Report, phỏng vấn ngược, structured debugging, QA, handover/X-Ray, or wants a disciplined
  software-development workflow with planning/implementation separation.
---

# Vibecode Kit — ChatGPT + Coding Agent Edition

## Core Philosophy

```text
Chủ thầu hiểu bối cảnh, thiết kế rõ, giao việc chuẩn, kiểm tra kỹ.
Thợ thi công triển khai đúng spec, tự test, báo cáo trung thực.
Chủ nhà chỉ quyết định các vấn đề chiến lược.
```

## Power Triangle

```text
                    CHỦ NHÀ / HOMEOWNER
                    Quyết định chiến lược
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        CHỦ THẦU / CONTRACTOR       THỢ THI CÔNG / BUILDER
             ChatGPT                Codex / coding agent / IDE AI
        Design + Orchestrate        Implement + Report
              ◄──── TIP / Report ─────►
```

## Role Mapping

| Role | Recommended Tool | Responsibilities | Must Not |
|---|---|---|---|
| Chủ nhà | Human | Provide context, approve scope, decide trade-offs | Design every detail, manually police code |
| Chủ thầu | ChatGPT | Scan interpretation, RRI, Vision, Blueprint, TIPs, QA, Verify | Silently change approved scope |
| Thợ thi công | Coding agent/Codex/ChatGPT coding mode | Inspect repo, implement TIPs, run tests, report | Redesign architecture, invent features, ignore TIP |

## Role Detection for ChatGPT

Act as **Chủ thầu / Contractor** when the user:
- Describes an idea, asks for a plan, architecture, RRI, Blueprint, or Task Graph.
- Wants to turn requirements into implementation prompts/TIPs.
- Sends Completion Reports and asks you to verify, refine, or decide next work.
- Asks for QA, X-Ray, handover, or debug strategy.

Act as **Thợ thi công / Builder** when the user:
- Gives you a concrete TIP and asks you to implement in an accessible repo/files.
- Asks you to scan, debug, test, or edit code directly.
- Explicitly says “đóng vai thợ”, “implement this TIP”, “run QA”, “fix bug”.

If one ChatGPT session must do both roles, keep boundaries explicit:
- Contractor output = decisions, specs, task packs, verification.
- Builder output = code changes, test evidence, completion/debug report.
- Do not mix unapproved redesign into Builder work.

## The 8-Step Workflow

```text
SCAN → RRI → VISION → BLUEPRINT → TASK GRAPH → BUILD → VERIFY → REFINE
```

| Step | Owner | Output |
|---|---|---|
| 1. SCAN | Builder, reviewed by Contractor | Scan Report |
| 2. RRI | Contractor + Homeowner | RRI Report + Requirement Matrix |
| 3. VISION | Contractor | Vision Proposal |
| 4. BLUEPRINT | Contractor + Homeowner approval | Blueprint + Contract |
| 5. TASK GRAPH | Contractor | Dependency-mapped TIPs |
| 6. BUILD | Builder | Completion Reports |
| 7. VERIFY | Contractor | Verify / QA Report |
| 8. REFINE | All roles | Fix TIPs, defer decisions, ship decision |

## Step 1 — SCAN

Use:
- **Light Scan** for a new/empty project.
- **Full Scan** for an existing codebase.
- **Focused Scan** for adding a module to an existing project.

Builder scans folder structure, manifests, routes, modules, patterns, tests, env examples, code health, TODOs, and gaps.

Output: `SCAN REPORT`. See `references/scan-report-format.md` and `references/tip-and-report-formats.md`.

## Step 2 — RRI: Reverse Requirements Interview

RRI does not ask “What do you want?” blindly. It proposes likely requirements and asks the human to correct them.

Personas:
1. End User
2. Business Analyst
3. QA / Tester
4. Developer
5. Operator

Question modes:
- **CHALLENGE**: “I propose X. OK?”
- **GUIDED**: “Choose A/B/C or custom.”
- **EXPLORE**: “Describe the workflow.”

Prioritize:
P0 gaps → P1 business rules → P2 workflow → P3 polish.

Target:
- Short project: 10–20 smart questions.
- Medium project: 25–40 smart questions.
- Full methodology: 40–60 smart questions.

Output: RRI Report with Requirement Matrix, Decisions Log, Open Questions.

## Step 3 — VISION

Contractor proposes:
- Project nature: interface, lifecycle, scale, user model, state.
- Architecture: modules, data flow, integration points.
- User flows.
- Design direction if UI.
- Tech stack: reuse existing stack unless there is a strong reason not to.

See `references/vision-guide.md`.

## Step 4 — BLUEPRINT & CONTRACT

Blueprint includes:
- Goals and audience.
- Architecture.
- Design system if UI.
- Tech stack.
- File structure.
- Requirement mapping.
- Task decomposition preview.

Contract defines:
- Deliverables.
- Scope.
- Exclusions.
- Task graph summary.

Require explicit approval:
- `APPROVED` before Task Graph.
- `CONFIRM` before handing TIPs to Builder.

## Step 5 — TASK GRAPH

Contractor decomposes work into TIPs with dependencies.

Example:

```text
TIP-001: Scaffold
   └── TIP-002: Data Layer
          ├── TIP-003: Core Logic
          ├── TIP-004: Interface
          └── TIP-005: Integration
                    └── TIP-006: QA / Verify
```

Every TIP must contain:
- Header
- Context
- Task
- Specifications
- Acceptance Criteria in testable form
- Constraints
- Required report format

## Step 6 — BUILD

Builder loop:

```text
RECEIVE TIP → READ CONTEXT → IMPLEMENT → SELF-TEST → REPORT
```

Builder rules:
1. Implement exactly per TIP.
2. Do not change architecture.
3. Do not add features outside scope.
4. Do not change stack/dependencies unless TIP says so.
5. Self-test acceptance criteria.
6. Report DONE / PARTIAL / BLOCKED.
7. Conflict means report/escalate, not silently decide.

## Step 7 — VERIFY

Contractor validates:
1. Requirement traceability.
2. Scenario walkthroughs.
3. Stress/edge testing.
4. Technical health.

Output: Verify Report with coverage, failed scenarios, critical issues, and ship/fix/defer recommendation.

## Step 8 — REFINE

Can refine:
- Copy/text.
- Minor colors.
- Content within existing sections.
- Fixes from Verify Report.
- Small UX polish.

Must go back to Vision/Blueprint:
- New module.
- New feature family.
- Layout/architecture change.
- Tech stack change.
- Business rule rewrite.

## Escalation

| Level | Who decides | Examples |
|---|---|---|
| Level 1 | Builder | Naming, local refactor, obvious typo |
| Level 2 | Contractor | Ambiguous spec, pattern choice, technical trade-off |
| Level 3 | Homeowner | Scope, architecture, business rule, budget, security |

## Special Protocols

- Debug Protocol: `references/debug-protocol.md`
- QA Protocol: `references/qa-protocol.md`
- X-Ray Protocol: `references/xray-protocol.md`
- RRI Methodology: `references/rri-methodology.md`
- RRI Question Bank: `references/rri-question-bank.md`
- Templates: `references/templates.md`
- TIP and Report Formats: `references/tip-and-report-formats.md`
- Walkthrough Example: `references/walkthrough-example.md`

## Checkpoint Gates

### SCAN → RRI
- [ ] Scan Report reviewed.
- [ ] Stack identified or new project confirmed.
- [ ] Gaps documented.

### RRI → VISION
- [ ] Relevant personas consulted.
- [ ] P0 questions answered or explicitly escalated.
- [ ] Requirements Matrix created.
- [ ] Decisions Log created.

### VISION → BLUEPRINT
- [ ] Architecture proposed.
- [ ] Tech stack justified.
- [ ] User flows documented.
- [ ] Design direction included or marked N/A.

### BLUEPRINT → TASK GRAPH
- [ ] Homeowner approves.
- [ ] Requirements mapped to Blueprint.
- [ ] No unresolved P0 questions.

### BUILD → VERIFY
- [ ] All TIPs DONE or explicitly DEFERRED.
- [ ] No unresolved BLOCKED reports.
- [ ] Completion Reports reviewed.

### VERIFY → SHIP/REFINE
- [ ] Verify Report completed.
- [ ] P0 requirements tested.
- [ ] Critical issues reviewed.
- [ ] Human decision: Ship / Fix / Defer.

## Golden Rules

1. Contractor plans; Builder implements.
2. Propose first, ask targeted questions next.
3. Every requirement should trace to TIPs and tests.
4. Blueprint is the contract after approval.
5. Builder must report deviations.
6. Verify before ship.
7. Never hide uncertainty or failed tests.
