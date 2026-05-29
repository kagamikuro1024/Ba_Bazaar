# Vision Guide — ChatGPT Edition

## Purpose

The Contractor uses this guide to propose a coherent software Vision from first principles. It works for web apps, mobile apps, APIs, CLIs, data pipelines, libraries, automation scripts, and AI workflows.

## 4-Step Vision Process

## Step 1 — Classify Project Dimensions

| Dimension | Question | Examples |
|---|---|---|
| Interface | How do users interact? | Web, mobile, CLI, API, desktop |
| Data flow | Where does data come from/go? | User input, DB, files, APIs, streams |
| User model | Who uses it? | Single user, roles, teams, tenants |
| Lifecycle | What is the core loop? | CRUD, event-driven, pipeline, realtime |
| Scale | Expected scope? | Personal, class project, team, public, enterprise |
| State | Where does state live? | Stateless, session, local storage, DB |
| Risk | What can go wrong? | Security, data loss, cost, UX friction |

## Step 2 — Derive Architecture

Identify:
- Entry points: pages, routes, commands, endpoints.
- Core modules: business logic units.
- Data layer: models, schemas, storage.
- Integration points: external services/APIs.
- Cross-cutting concerns: auth, validation, logging, errors, config.

Architecture output should answer:
- What are the parts?
- How do they communicate?
- What owns each responsibility?
- What should not be coupled?

## Step 3 — User Flows

For each user type:
- Entry: first screen/command/API call.
- Core loop: repeated action.
- Edge cases: empty/error/permission states.
- Exit: completion, export, save, deploy, close.

For non-UI:
- CLI: command flow, arguments, output, exit codes.
- API: request/response flow, auth, error schema.
- Pipeline: trigger, transform, validate, load, monitor.
- Library: public API, examples, error handling.

## Step 4 — Design Direction

For UI projects:
- Layout pattern.
- Navigation model.
- Component style.
- Density: spacious/compact/mixed.
- Typography and colors.
- Motion: none/subtle/expressive.

For non-UI projects:
- CLI output style: table/json/plain.
- API naming: REST/RPC/GraphQL, versioning.
- Pipeline observability: logs, checkpoints, retry.
- Library API style: fluent, functional, object-oriented.

## Step 5 — Tech Stack

If existing codebase:
- Reuse current stack unless there is a strong reason not to.
- Fit new modules into existing patterns.
- Avoid stack churn.

If new project:
- Choose stable, familiar, well-documented tools.
- Prefer boring tech for core reliability.
- Justify each major dependency.
- Avoid overengineering for prototypes.

## UI Design Defaults

Use only when UI is relevant.

| Style | Heading | Body |
|---|---|---|
| Modern Tech | Plus Jakarta Sans | Inter |
| Professional | DM Sans | Source Sans Pro |
| Friendly | Poppins | Open Sans |
| Creative | Playfair Display | Lato |
| Startup | Space Grotesk | Work Sans |

| Purpose | Color | Hex |
|---|---|---|
| Trust | Blue | #2563EB |
| Action | Orange | #F97316 |
| Growth | Green | #22C55E |
| Premium | Purple | #7C3AED |
| Warning | Red | #EF4444 |
| Neutral | Gray | #6B7280 |

## Vision Proposal Format

```markdown
Chào Chủ nhà!

Based on [Scan Report / your description], I propose:

════════════════════════════════════════
PROJECT: [Name]
NATURE: [Interface] + [Lifecycle] + [Scale]
════════════════════════════════════════

## Architecture
[building blocks + relationships]

## User Flows
[primary journeys]

## Design Direction
[UI direction or non-UI interface conventions]

## Tech Stack
[choices + rationale]

## Assumptions
- [assumption]

## Risks / Questions for RRI
- [P0/P1 gap]

Next: I will run RRI to confirm and customize this Vision.
```
