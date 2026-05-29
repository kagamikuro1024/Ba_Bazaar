# RRI Methodology Family — ChatGPT Edition

## Overview

RRI means **Reverse Requirements Interview**.

Instead of asking:

```text
What do you want?
```

Contractor says:

```text
Based on the context, I think you need X. Correct?
```

RRI reduces vague back-and-forth by combining scan evidence, domain assumptions, and targeted human decisions.

## Family

```text
RRI       = discover requirements
RRI-T     = test correctness
RRI-UX    = critique user experience
RRI-UI    = design and validate interface quality
```

## RRI Core

### 3 Layers

1. **Auto-answered** — already known from Scan, existing files, or user context.
2. **Smart-asked** — adapted to the actual project.
3. **Challenge-proposed** — Contractor proposes a default, human approves/rejects.

### 5 Personas

| Persona | Focus |
|---|---|
| End User | Workflow, UX, devices, frustrations |
| Business Analyst | Goals, rules, data relationships, KPIs |
| QA / Tester | Validation, errors, edge cases, security |
| Developer | Architecture, patterns, tech debt, maintainability |
| Operator | Deployment, monitoring, backup, scaling |

Developer persona may be skipped for a brand-new project.
Operator persona may be shortened for prototypes.

### 3 Question Modes

| Mode | Use When | Example |
|---|---|---|
| CHALLENGE | Known pattern | “I propose email/password auth. OK?” |
| GUIDED | Few valid options | “Export: CSV only, Excel, or PDF too?” |
| EXPLORE | Unknown workflow | “Describe what happens when an order is disputed.” |

### Prioritization

```text
P0 = must answer before design
P1 = important business/quality rule
P2 = workflow/edge detail
P3 = polish/preference
```

### RRI Output

```markdown
# RRI REPORT: [Project]

## Requirements Matrix
| REQ-ID | Requirement | Source | Priority | Persona |
|---|---|---|---|---|

## Auto-Answered
- [item] → [evidence/source]

## Decisions Log
| Decision | Options | Chosen | Rationale |
|---|---|---|---|

## Open Questions
- [OQ-ID] [question] [risk]
```

## RRI-T — Testing Methodology

Formula:

```text
5 Personas × 7 Testing Dimensions × 8 Stress Axes
```

### 7 Testing Dimensions

1. UI/UX
2. Business logic
3. Data integrity
4. Integration
5. Performance
6. Security
7. Operational readiness

### 8 Stress Axes

1. Time
2. Data volume
3. Error/failure
4. Collaboration/concurrency
5. Emergency/recovery
6. Scale
7. Compliance
8. Evolution/versioning

### RRI-T Results

- `PASS` — correct.
- `ACCEPTABLE` — works, suboptimal.
- `PAINFUL` — not broken but frustrating.
- `FAIL` — broken or requirement unmet.

## RRI-UX — UX Critique

### 5 UX Personas

1. First-timer
2. Daily user
3. Power user
4. Reluctant user
5. Accessibility user

### 7 UX Dimensions

1. Discoverability
2. Learnability
3. Efficiency
4. Error prevention
5. Recovery
6. Satisfaction
7. Consistency

### 8 Flow Physics Axes

1. Friction
2. Cognitive load
3. Interruption
4. Dead ends
5. Speed bumps
6. Anxiety
7. Frustration
8. Delight

## RRI-UI — Interface Design

Pipeline:
1. Setup: load requirements, user flows, constraints.
2. RRI-UX critique: find UX risks before coding.
3. Design iteration: fix risks.
4. RRI-T validation: test implemented interface.
5. Polish: resolve remaining issues.

Use RRI-UI for web/mobile/desktop UI. For API/CLI/data projects, adapt the “interface” to endpoints, command UX, or pipeline operations.
