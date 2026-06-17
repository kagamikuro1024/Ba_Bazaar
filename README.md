---
title: BA Bazaar
sdk: docker
app_port: 7860
pinned: false
---

# BA Bazaar

BA Bazaar is an internal **BA Booking & CRM** system that turns ad-hoc, spreadsheet-driven
BA allocation into a data-driven workflow: **request → AI-suggested BA → approve**, with hard
guardrails against overbooking, real man-day utilization, and AI assistance throughout.

It serves four roles:

- **PM/PO** — creates booking requests for BAs.
- **BA Manager** — approves/assigns requests, resolves capacity conflicts, manages the BA pool.
- **BA** — sees their own schedule and workload.
- **IT Admin** — technical operations: user/role management, audit logs, and AI observability.

> ## ⚠️ Auto-seed (read this)
> **The database is RESET and re-seeded automatically** in two situations:
> - **`pnpm dev`** — every dev start wipes and re-seeds (you always get fresh demo data; any data you created while testing is lost).
> - **Deploy / boot with `SEED_ON_START=true`** — the API reseeds on every container start.
>
> Seeding **drops and recreates** all demo data (`resetDatabase`). This is intended for **dev/demo only** — **never enable `SEED_ON_START` against a real production database with real user data.** To run the API without seeding, use `pnpm --filter @ba-bazaar/api serve` (dev) or leave `SEED_ON_START` unset (deploy).

## Scope: date-range booking only

Bookings are date-range based and must stay that way:

```ts
start_date: Date;
end_date: Date;
capacity_percent: 25 | 50 | 75 | 100; // percent of a working day
```

Do **not** add hourly fields (`start_datetime`, `end_datetime`, `start_time`, `end_time`).
Man-day utilization is computed per **working day** (weekends excluded).

## Tech stack

- **Monorepo:** pnpm workspaces.
- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn/ui foundation + React Router + TanStack Query.
- **Backend (runtime):** **Go** HTTP API (`apps/api/cmd/api`, chi router, raw SQL via pgx).
- **Database:** PostgreSQL (Docker Compose). **Prisma owns the schema + migrations only**; the Go API reads/writes via SQL. A legacy NestJS server under `apps/api/src` is retained as a secondary path.
- **AI:** DeepSeek (optional). Used for *Suggest BA*, *Extract Skill from PRD*, and grounded page summaries. All AI is grounded/cited and never mutates data — humans click the final action. Set `DEEPSEEK_API_KEY` to enable; otherwise deterministic fallbacks are used.

## Folder structure

```text
apps/
  web/                React + Vite frontend
  api/
    cmd/api/          Go HTTP API (runtime) + seed (seed.go, seed_bookings.go)
    prisma/           schema.prisma + migrations (schema source of truth)
    src/              legacy NestJS server (secondary)
packages/
  shared/             shared TS constants/types
```

## Local setup

Prerequisites: Node 20+, pnpm 10+, Go 1.24+, Docker.

```bash
pnpm install
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

Start PostgreSQL (dev compose runs Postgres only, on port 5432):

```bash
docker compose -f docker-compose.dev.yml up -d
```

Apply schema, then run the app (which **auto-seeds** — see warning above):

```bash
pnpm db:migrate      # prisma migrate dev
pnpm dev             # seeds, then runs web (:5173) + API (:3000)
```

Manual seed any time (resets the DB): `pnpm db:seed` (= `go run ./cmd/api seed`).

## Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| BA Manager | `manager@ba-bazaar.local` | `Manager@123` |
| IT Admin | `it-admin@ba-bazaar.local` | `ItAdmin@123` |
| Admin (legacy) | `admin@ba-bazaar.local` | `Admin@123` |
| PM/PO | `pm1@ba-bazaar.local` … `pm5@ba-bazaar.local` | `Pmpo@123` |
| BA | `ba1@ba-bazaar.local` … `ba15@ba-bazaar.local` | `Ba@123` |

Seed data: 1 BA Manager, 1 Admin, 1 IT Admin, 5 PM/PO, **15 BA profiles**, projects, skill tags,
**~35 bookings across all statuses** (most in the future, a few completed, with built-in capacity
conflicts for the demo), private notes, notifications, AI feature flags & settings.
**All booking dates are anchored to "today"** at seed time, so data never goes stale.

## Key routes

- `/dashboard` — role-aware dashboard (PM/PO, BA Manager, BA).
- `/timeline` — Gantt timeline; man-day utilization % per BA; capacity-conflict flags.
- `/manager/action-center` — request queue (urgent / unassigned / capacity conflict). *Manager*
- `/crm/ba`, `/crm/ba/:id` — BA Directory & profiles (create BA, skills).
- `/reports` — utilization, bench, capacity conflicts, CSV export, AI summary. *Manager*
- `/my-schedule`, `/my-requests` — BA / PM views.
- `/admin/dashboard`, `/admin/users`, `/admin/audit-logs` — IT Admin.
- `/admin/ai/observability`, `/admin/ai/sessions`, `/admin/ai/tool-calls`, `/admin/ai/errors`, `/admin/ai/feedback`, `/admin/ai/feature-flags`, `/admin/ai/settings` — IT Admin AI Observability.

API health: `curl http://localhost:3000/health` → `{"status":"ok","service":"ba-bazaar-api"}`.

## Capacity & overbooking rules

- **Capacity conflict** = overlapping pending requests could push a BA past 100% if approved — *allowed* to create, flagged for the manager.
- **Approving over 100% is blocked** by the API on any working day, with an actionable message (reduce capacity, assign another BA, or split the work).
- **Invalid overbook** = already-approved capacity over 100% (a data issue), shown distinctly.

## Scripts

```bash
pnpm dev            # web + API (API auto-seeds first)
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm db:migrate     # apps/api: prisma migrate dev
pnpm db:seed        # apps/api: go run ./cmd/api seed  (RESETS the DB)
```

Run the API without seeding: `pnpm --filter @ba-bazaar/api serve`.

## Deployment

`docker-compose.prod.yml` builds the Go API + web behind a Caddy reverse proxy, with a
persistent Postgres volume.

- Run migrations on the target DB first (`prisma migrate deploy`).
- Set `SEED_ON_START=true` on the API service **only for a dev/demo deployment** to reseed on boot
  (see the auto-seed warning above). Leave it unset for any real production DB.
- Before real production: rotate `JWT_SECRET` and DB credentials, restrict DB network exposure,
  add TLS, and set up backups.
