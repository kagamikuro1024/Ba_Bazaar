# Scan Report Format — ChatGPT + Coding Agent Edition

## When to Scan

| Scenario | Scan Type |
|---|---|
| Brand-new project | Light Scan |
| Existing repo | Full Scan |
| Add feature/module | Focused Scan |
| Debug unknown issue | Debug Scan |

## Builder Scan Instruction

```markdown
# SCAN INSTRUCTION

## ROLE
You are the Builder. Inspect the codebase and report facts. Do not redesign.

## TASKS
1. Scan folder structure, max 3 levels.
2. Read manifests: package.json, pyproject.toml, Cargo.toml, go.mod, etc.
3. Identify tech stack and dependencies.
4. List routes/pages/entry points/commands.
5. Identify patterns: auth, API, DB, state, config, styling.
6. Read README/docs/CHANGELOG if present.
7. Check tests and scripts.
8. Find env templates and required variables.
9. Assess code health: type safety, linting, TODOs, debug logs.
10. List gaps and risks.

## OUTPUT
Use the Scan Report format below.
```

## Scan Report Format

```markdown
# SCAN REPORT: [Project Name]

## Scope
Scan type: Light / Full / Focused / Debug
Working directory: [path]
Date: [date]

## Tech Stack
- Language:
- Framework:
- Styling/UI:
- Database:
- Auth:
- State management:
- Testing:
- Build/deploy:
- Other:

## Structure
```text
[folder tree max 3 levels]
```

## Existing Modules
| Module | Path | Purpose | Notes |
|---|---|---|---|

## Entry Points
| Type | Path/Command | Purpose |
|---|---|---|

## Patterns Detected
| Pattern | Where | How to reuse |
|---|---|---|

## Reusable Components / Utilities
| Item | Path | Purpose |
|---|---|---|

## Environment
| Variable | Required? | Purpose | Source |
|---|---|---|---|

## Tests & Scripts
| Command | Purpose | Result if run |
|---|---|---|

## Code Health
- Type safety:
- Linting:
- Tests:
- Debug artifacts:
- TODO/FIXME:
- Dependency concerns:
- Security concerns:

## Gaps Detected
| Gap | Severity | Evidence | Recommendation |
|---|---|---|---|

## Estimated Size
- Files:
- Lines of code:
- Components/modules:
- API endpoints/routes:
```

## Contractor Response After Scan

```markdown
Chủ nhà, mình đã nhận Scan Report.

## Codebase Overview
[brief factual summary]

## What this means
- Questions already answered by Scan: [list]
- Gaps requiring RRI: [list]
- Risks to address in Blueprint: [list]

Next step: RRI interview.
```
