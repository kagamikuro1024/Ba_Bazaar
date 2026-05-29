# Templates — ChatGPT + Coding Agent Edition

## Vision Proposal

```markdown
Chào Chủ nhà!

Based on [your description / Scan Report], I propose this VISION:

════════════════════════════════════════
PROJECT: [Name]
NATURE: [Interface] + [Lifecycle] + [Scale]
════════════════════════════════════════

## Architecture
[major modules + how they connect]

## User Flows
[primary journeys per user type]

## Design Direction
[if UI: layout, visual style, density, motion]
[if non-UI: CLI/API/pipeline interface conventions]

## Tech Stack
[reuse existing stack or explain choices]

## Key Assumptions
- [assumption]

Next: I will run RRI to confirm requirements and close gaps.
```

## Refine Request

```markdown
Module [X] is [Y]% complete.

## Completed
- [done items]

## Remaining Issues
| Issue | Severity | Options | Recommendation |
|---|---|---|---|

## Deferred
- [feature/issue] — [reason]

Choose:
A. Ship as-is
B. Fix recommended issues
C. Fix all issues
D. Custom
```

## Task Graph

```text
TIP-001: Scaffold
    └── TIP-002: Data Layer
            ├── TIP-003: Core Logic
            ├── TIP-004: Interface
            └── TIP-005: Integration
                    └── TIP-006: QA / Verify
```

## Level 2 Escalation — Builder to Contractor

```markdown
# ESCALATION REPORT — Level 2

TIP: TIP-[XXX]
Issue: [description]
Category: Spec ambiguity / Pattern choice / Performance trade-off / Dependency conflict

## Evidence
- [facts]

## Options
A. [option] — Pros: [...] Cons: [...]
B. [option] — Pros: [...] Cons: [...]

## Builder Recommendation
[option] because [reason]

Need Contractor decision.
```

## Level 3 Escalation — Contractor to Homeowner

```markdown
# ESCALATION REPORT — Level 3

Issue: [description]
Impact: [what changes]
Category: Scope / Architecture / Business rule / Budget / Security

## Options
A. [option] — Impact: [...]
B. [option] — Impact: [...]

## Contractor Recommendation
[option] because [reason]

Need your decision.
```

## ChatGPT Prompt Header for Builder Mode

```markdown
# Vibecode Builder Mode

You are the Builder for this task.

Rules:
1. Follow the TIP exactly.
2. Do not change architecture unless instructed.
3. Do not add out-of-scope features.
4. Run or describe relevant tests.
5. Report DONE / PARTIAL / BLOCKED.
6. Escalate ambiguity instead of guessing.

[Paste project context]
[Paste TIP]
```
