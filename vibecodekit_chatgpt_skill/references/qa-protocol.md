# QA Protocol — ChatGPT + Coding Agent Edition

## When to Activate

Use when:
1. VERIFY phase begins.
2. A milestone is complete.
3. User asks “nghiệm thu”, “test”, “QA”, “kiểm tra”.
4. Before deployment or handover.

## Principles

1. Test against requirements, not vibes.
2. Trace tests to REQ-IDs and TIP Acceptance Criteria.
3. Tier 1 must pass before release unless explicitly deferred.
4. Failures need evidence and severity.
5. QA output must recommend: APPROVED / NEEDS WORK / BLOCKED.

## 6-Step Process

```text
CONTEXT → GENERATE → EXECUTE → REPORT → FIX → VERIFY
```

## Tier 1 — Core Functionality

Mandatory:
- App/build starts without critical errors.
- Main user flow works.
- Every TIP Acceptance Criteria checked.
- Every P0 requirement checked.
- No placeholders/TODO UI in shipped paths.
- Required assets and links work.
- No obvious console/runtime errors.

Coverage target:
- P0: 100%
- P1: ≥90% unless deferred
- P2: best effort

## Tier 2 — Robustness

Recommended:
- Empty states.
- Invalid inputs.
- Boundary values.
- Error messages.
- Loading states.
- Network/API failure.
- Concurrent or repeated actions.
- Responsive layout for UI projects.

Suggested breakpoints:
- Mobile: 375×667, 390×844
- Tablet: 768×1024, 1024×1366
- Desktop: 1366×768, 1920×1080

## Tier 3 — Performance, Accessibility, Security

Optional but important:
- Load time acceptable.
- No major layout shift.
- No obvious memory leak.
- Keyboard navigation for core flows.
- Alt text for meaningful images.
- Contrast acceptable.
- No secrets in client code/logs.
- Auth/authorization enforced.
- Inputs sanitized.

## Result Labels

- `PASS` — works and criteria met.
- `FAIL` — broken or requirement unmet.
- `PARTIAL` — works but with notable issue.
- `SKIP` — not applicable or explicitly deferred.

## QA Report Format

```markdown
# QA REPORT: [Project Name]

Date: [date]
Environment: [local/staging/prod]
Version/branch: [if known]

## Summary

| Tier | Passed | Failed | Partial | Skipped | Status |
|---|---:|---:|---:|---:|---|
| Tier 1 |  |  |  |  |  |
| Tier 2 |  |  |  |  |  |
| Tier 3 |  |  |  |  |  |

Requirement Coverage: [X/Y] = [Z]%
TIP AC Pass Rate: [X/Y] = [Z]%
Overall Status: APPROVED / NEEDS WORK / BLOCKED

## Test Results

| ID | Requirement / AC | Test | Result | Evidence |
|---|---|---|---|---|

## Issues

| Severity | Issue | Affected REQ/TIP | Evidence | Recommendation |
|---|---|---|---|---|

## Sign-off Checklist

- [ ] Tier 1 passed or deferrals approved.
- [ ] Critical issues = 0.
- [ ] P0 coverage = 100%.
- [ ] Build/test commands recorded.
- [ ] Human decision recorded.
```

## 5-Minute Quick QA

```text
[ ] App starts
[ ] Main flow works
[ ] Build succeeds
[ ] No console/runtime errors in main flow
[ ] Mobile layout not broken if UI
[ ] No placeholder content in shipped paths
[ ] Links/assets load
[ ] Error/empty states are not blank
```
