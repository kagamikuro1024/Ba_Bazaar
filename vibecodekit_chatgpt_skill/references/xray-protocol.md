# X-Ray Protocol — ChatGPT + Coding Agent Edition

## When to Activate

Use for:
1. Handover to another developer/team/client.
2. Upgrade/refactor planning.
3. Onboarding.
4. Archiving.
5. Pre-build scan before adding major module.
6. “Explain this project deeply.”

## Goals

The receiver should understand:
1. What the project does.
2. Why it exists.
3. How to run it.
4. How modules connect.
5. How to fix basic bugs.
6. How to add features.
7. How requirements map to implementation.
8. What remains risky or incomplete.

## 6-Step Process

```text
SCAN → ANALYZE → DOCUMENT → TRACE → PACKAGE → VERIFY
```

## Step 1 — Scan

Produce a full Scan Report:
- Tech stack.
- Structure.
- Modules.
- Patterns.
- Tests.
- Env vars.
- Gaps.
- Code health.

## Step 2 — Analyze

Produce:
- Project overview.
- Architecture diagram.
- Data flow.
- Dependency map.
- Risk map.

Example architecture:

```text
[Client/UI] → [Routes/API] → [Services] → [Database]
                 │              │
                 └── Auth       └── External APIs
```

## Step 3 — Document

Create `PROJECT_XRAY.md`:

```markdown
# PROJECT XRAY: [Project]

## 1. Overview
## 2. Quick Start
## 3. Architecture
## 4. Key Components
## 5. API / Commands / Screens
## 6. Data Model
## 7. Environment Variables
## 8. Requirements Traceability
## 9. Build / TIP History
## 10. Testing
## 11. Deployment
## 12. Common Tasks
## 13. Troubleshooting
## 14. Technical Debt
## 15. Future Improvements
```

## Step 4 — Trace

For Vibecode projects:
- Requirement → Blueprint section → TIP → changed files → tests.
- Completion Reports → build history.
- Debug Reports → known issues and lessons.

Traceability table:

```markdown
| REQ-ID | Feature | TIP | Files | Test Evidence | Status |
|---|---|---|---|---|---|
```

## Step 5 — Package

Checklist:
- [ ] PROJECT_XRAY.md
- [ ] README.md updated
- [ ] .env.example present
- [ ] Build/test commands documented
- [ ] Known issues documented
- [ ] No secrets committed
- [ ] No unnecessary debug logs
- [ ] Critical TODOs resolved or listed
- [ ] Vibecode artifacts included if available

## Step 6 — Verify

Fresh clone test:
1. Clone repo.
2. Install dependencies.
3. Configure env.
4. Run dev.
5. Run tests.
6. Execute main user flow.

Traceability check:
- Feature → REQ-ID → TIP → files → test.

## Code Health Indicators

### Healthy
- Strict typing or clear schemas.
- Linting configured.
- Tests present.
- README accurate.
- Env documented.
- No critical TODOs.

### Needs Attention
- Some debug logs.
- Sparse tests.
- Outdated dependencies.
- Missing docs.

### Technical Debt
- Hardcoded secrets.
- `any` everywhere.
- No error handling.
- No env templates.
- Large commented-out blocks.
- No build/test path.
