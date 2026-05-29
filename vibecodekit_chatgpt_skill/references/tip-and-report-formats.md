# TIP & Report Formats — ChatGPT + Coding Agent Edition

## 1. Scan Instruction

```markdown
# SCAN INSTRUCTION

## ROLE
You are the Builder. Scan the codebase and report facts.

## TASKS
1. Folder tree, max 3 levels.
2. Manifests and dependencies.
3. Entry points/routes/pages/commands.
4. Patterns: auth, API, DB, state, config, styling.
5. README/docs/CHANGELOG.
6. Tests/scripts.
7. Env examples.
8. Code health.
9. Gaps and risks.

## OUTPUT
Return a SCAN REPORT.
```

## 2. Scan Report

```markdown
# SCAN REPORT: [Project]

TECH_STACK:
  Language:
  Framework:
  Styling:
  Database:
  Auth:
  State:
  Testing:
  Other:

STRUCTURE:
[tree max 3 levels]

EXISTING_MODULES:
- [module]: [path] — [purpose]

ENTRY_POINTS:
- [route/page/command]: [purpose]

PATTERNS_DETECTED:
- [pattern]: [where] — [how to reuse]

REUSABLE_COMPONENTS:
- [item]: [path] — [purpose]

ENVIRONMENT:
- [var]: [required?] — [purpose]

CODE_HEALTH:
  Type Safety:
  Linting:
  Tests:
  Debug Artifacts:
  TODO/FIXME:
  Security Notes:

GAPS_DETECTED:
- [severity] [gap] — [evidence] — [recommendation]

ESTIMATED_SIZE:
  Files:
  LOC:
  Modules:
  Endpoints/Routes:
```

## 3. RRI Report

```markdown
# RRI REPORT: [Project]
Generated: [date]

## Requirements Matrix
| REQ-ID | Requirement | Source | Priority | Persona |
|---|---|---|---|---|

## Auto-Answered
- [fact] → [source/evidence]

## Decisions Log
| Decision ID | Options | Chosen | Rationale |
|---|---|---|---|

## Open Questions
| OQ-ID | Question | Risk | Owner |
|---|---|---|---|
```

## 4. Blueprint

```markdown
# BLUEPRINT: [Project]

## Project Info
| Field | Value |
|---|---|
| Project |  |
| Nature |  |
| Date |  |

## Goals
Primary goal:
Target users:
Success criteria:

## Architecture
[modules, data flow, boundaries]

## User Flows
[flow per user type]

## Design System
[for UI projects only: colors, typography, layout, components]

## Tech Stack
[chosen stack + rationale]

## File Structure
```text
[proposed structure]
```

## Requirement Mapping
| Blueprint Section | Requirements | Notes |
|---|---|---|

## Task Decomposition Preview
- TIP-001:
- TIP-002:
- TIP-003:

## Checkpoint
- [ ] Architecture acceptable
- [ ] Requirements mapped
- [ ] Design direction acceptable or N/A
- [ ] Scope complete
- [ ] No unresolved P0 questions

Reply `APPROVED` to continue.
```

## 5. Contract

```markdown
# CONTRACT: [Project]

## Deliverables
| # | Item | Details | Requirements |
|---|---|---|---|

## Tech Stack
- [stack]

## In Scope
- [item]

## Out of Scope
- [item]

## Task Graph Summary
[X] TIPs

Reply `CONFIRM` to receive TIPs.
```

## 6. Task Instruction Pack

```markdown
# TIP-[XXX]: [Task Name]

## Header
- TIP-ID: TIP-[XXX]
- Project:
- Module:
- Depends on:
- Priority: P0 / P1 / P2
- Estimated effort:

## Context
- Working directory:
- Key files:
- Existing patterns to follow:
- Related requirements:

## Task
[clear task]

## Specifications
- [business rules]
- [validation]
- [errors]
- [data/API/UI details]

## Acceptance Criteria
Given [condition]
When [action]
Then [expected result]

## Constraints
- Do not [boundary]
- Reuse [patterns/components]
- Do not change [architecture/stack]

## Required Tests
- [command/manual test]

## Report Format
Return a Completion Report.
```

## 7. TIP Handover Prompt

```markdown
# Vibecode Kit — Task Instruction Pack

## ROLE
You are the BUILDER.
The Contractor and Homeowner approved the design.

## ABSOLUTE RULES
1. Implement exactly per TIP.
2. Do not change architecture.
3. Do not add out-of-scope features.
4. Do not change dependencies unless instructed.
5. Self-test acceptance criteria.
6. Report using Completion Report.
7. If conflict appears, report/escalate instead of guessing.

## PROJECT CONTEXT
[paste Scan/Blueprint summary]

## TASK INSTRUCTION PACK
[paste TIP]
```

## 8. Completion Report

```markdown
## COMPLETION REPORT — TIP-[XXX]

**STATUS:** DONE / PARTIAL / BLOCKED

**FILES CHANGED:**
- Created:
- Modified:
- Deleted:

**IMPLEMENTATION SUMMARY:**
- [what was built]

**TEST RESULTS:**
- Acceptance criteria: [X/Y passed]
- Commands run:
- Manual checks:

**ISSUES DISCOVERED:**
- [severity] — [description] — [recommendation]

**DEVIATIONS FROM SPEC:**
- [what] — [why] — [impact]

**SUGGESTIONS FOR CONTRACTOR:**
- [observation] — [recommendation]
```

## 9. Debug Completion Report

```markdown
## DEBUG COMPLETION REPORT

**STATUS:** FIXED / PARTIAL / BLOCKED
**BUG SUMMARY:**
**ROOT CAUSE:**

**FIX APPLIED:**
- File:
- Change:

**VERIFICATION:**
- Bug fixed:
- Tests:
- Build:
- Regression:

**ISSUES DISCOVERED:**
- [issue]

**LESSONS LEARNED:**
- [prevention]

**RELATED TIPs / REQs:**
- [ID]
```

## 10. Verify Report

```markdown
# VERIFY REPORT: [Project]

## Requirement Coverage
- Total:
- Implemented:
- Missing:
- Deferred:
- Coverage:

## Scenario Results
- Passed:
- Failed:
- Untestable:

## Technical Health
- Build:
- Type errors:
- Lint errors:
- Tests:

## Critical Issues
| Severity | Issue | Requirement | Recommendation |
|---|---|---|---|

## Decisions Needed
| Decision | Options | Recommendation |
|---|---|---|

## Overall Status
READY / NEEDS FIXES / MAJOR ISSUES
```
