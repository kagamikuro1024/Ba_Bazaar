# BA Bazaar

BA Bazaar is an internal BA Booking and CRM system for BA Managers, PM/PO users,
and BA users. This repository currently contains the TIP-001 foundation only:
monorepo structure, web shell, API health endpoint, shared package, environment
templates, and PostgreSQL Docker Compose setup.

## Scope Warning

Booking must remain date-range based:

```ts
start_date: Date;
end_date: Date;
capacity_percent: 50 | 100;
```

Do not implement hourly booking fields such as `start_datetime`, `end_datetime`,
`start_time`, or `end_time`.

## Tech Stack

- Monorepo: pnpm workspaces
- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui foundation, React
  Router, TanStack Query
- Backend: NestJS, TypeScript, `@nestjs/config`
- Database: PostgreSQL via Docker Compose
- Shared package: TypeScript constants/types placeholder

## Folder Structure

```text
apps/
  web/      React + Vite frontend shell
  api/      NestJS API foundation
packages/
  shared/   Shared constants/types placeholder
```

## Local Setup

Prerequisites:

- Node.js 20 or newer
- pnpm 10 or newer
- Docker with Docker Compose

Install dependencies:

```bash
pnpm install
```

## Environment Setup

Copy examples before local development:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/api/.env.example apps/api/.env
```

`JWT_SECRET` is included for future/internal mock auth use. Real auth is out of
scope for TIP-001.

## PostgreSQL Local

Start the local database:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Stop it:

```bash
docker compose -f docker-compose.dev.yml down
```

The dev compose file exposes PostgreSQL on local port `5432` by default. Override
with `POSTGRES_PORT` if needed.

## Database Schema

Prisma schema and migrations live in `apps/api/prisma`.

```bash
pnpm db:validate
pnpm db:migrate
pnpm db:generate
pnpm db:seed
```

The current schema includes users, BA profiles, skill tags, projects, bookings,
private notes, notifications, and audit logs. Booking uses `start_date`,
`end_date`, and `capacity_percent`; no hourly booking fields are present.

Seed data includes 1 BA Manager, 5 PM/PO users, 15 BA profiles, projects, tags,
bookings across all core statuses, private notes, and notifications.

## Running Web

```bash
pnpm dev:web
```

Default URL: `http://localhost:5173`

Placeholder routes:

- `/`
- `/timeline`
- `/my-schedule`
- `/my-requests`
- `/manager/inbox`
- `/crm/ba`
- `/crm/ba/:id`
- `/reports`

## Running API

```bash
pnpm dev:api
```

Default URL: `http://localhost:3000`

Health check:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "ba-bazaar-api"
}
```

## Root Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm format
```

Targeted commands:

```bash
pnpm build:web
pnpm build:api
pnpm --filter @ba-bazaar/shared build
```

## VPS Deployment Notes

`docker-compose.prod.yml` is a production-ready skeleton for a VPS:

- PostgreSQL uses a persistent named volume.
- API service has restart policy and `.env` usage.
- API Dockerfile builds the NestJS package from the monorepo.

Before production use, create a real `.env`, rotate secrets, restrict database
network exposure, add reverse proxy/TLS, and add backup monitoring.
