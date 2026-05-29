# Debug Protocol — ChatGPT + Coding Agent Edition

## When to Activate

Activate when:
1. A quick fix fails repeatedly.
2. A TIP returns `BLOCKED`.
3. The user says “debug”, “fix lỗi”, “điều tra”, “không đoán mò”.
4. Build/test output is unclear or conflicting.

## Core Principles

1. **Never guess blindly** — collect evidence first.
2. **Reproduce before fixing** — know how the bug happens.
3. **One change at a time** — fix, test, confirm.
4. **Separate root cause from symptom**.
5. **Report evidence and uncertainty honestly**.

## 9-Step Process

```text
EVIDENCE → CONTEXT → HYPOTHESES → INVESTIGATE → ROOT CAUSE
→ FIX DESIGN → IMPLEMENT → VERIFY → REPORT
```

## Step 1 — Evidence

Collect:
- Full error message / stack trace.
- Reproduction steps.
- Expected vs actual behavior.
- Recent changes.
- Screenshots/logs/network output if relevant.
- Related TIP/requirement if in Vibecode flow.

## Step 2 — Context

Scan:
- Related files.
- Project manifests.
- Test scripts.
- Recent diffs.
- Existing patterns.
- Environment variables.

Useful commands, adapt to stack:

```bash
git diff
git log --oneline -10

npm test
npm run build
npm run lint
npx tsc --noEmit

python -m pytest
python -m py_compile path/to/file.py

go test ./...
cargo test
```

## Step 3 — Hypotheses

Classify:
- Runtime
- Logic
- UI/render
- API/network
- State/data
- Build/config
- Dependency/version
- Spec conflict

Write 2–3 hypotheses:
- Confidence.
- Supporting evidence.
- Verification action.

## Step 4 — Investigate

For each hypothesis:
- Run a specific check.
- Record result.
- Confirm or reject.

Do not edit code until at least one hypothesis is evidence-backed.

## Step 5 — Root Cause

Document:
- What broke.
- Why it broke.
- Where it broke (`file:line` if possible).
- Why previous attempts failed.
- Whether escalation is needed.

## Step 6 — Fix Design

Before editing:
- What changes.
- Why it works.
- Files affected.
- Risks.
- Rollback plan.
- Whether it stays within TIP/Blueprint scope.

## Step 7 — Implement

Rules:
- Minimal necessary change.
- Preserve existing architecture.
- Avoid opportunistic refactors.
- No hidden dependency changes.
- Add/update tests where practical.

## Step 8 — Verify

Checklist:
- Bug no longer reproduces.
- Relevant tests pass.
- Build/type/lint checks pass if available.
- No obvious regression.
- Acceptance Criteria still pass.

## Step 9 — Report

```markdown
## DEBUG COMPLETION REPORT

**STATUS:** FIXED / PARTIAL / BLOCKED

**BUG SUMMARY:** [Short description]

**EVIDENCE COLLECTED:**
- [error/log/repro]

**ROOT CAUSE:**
- [what + why + where]

**FIX APPLIED:**
- [file]: [change]

**VERIFICATION:**
- Bug fixed: Yes/No
- Tests run: [commands + result]
- Regression check: [result]

**ISSUES DISCOVERED:**
- [severity] — [description]

**DEVIATIONS / RISKS:**
- [if any]

**NEXT RECOMMENDATION:**
- [ship / more testing / escalate]
```

## Escalation Report

Use when blocked:

```markdown
## DEBUG ESCALATION REPORT

**Problem:** [summary]
**Evidence:** [logs/repro]
**Hypotheses tested:** [confirmed/rejected]
**Current blocker:** [why cannot proceed]
**Files involved:** [paths]
**Decision needed:** [specific ask]
```
