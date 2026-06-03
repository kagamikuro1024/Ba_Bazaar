# Report — Nguyen Dang Hai

## Route smoke

| Route | Role | Result | Evidence |
|---|---|---|---|
| `/` → redirect | BA/PM/MANAGER | PASS — redirects based on mock role | |
| `/timeline` | ALL | PASS — no blank screen, has nav, no fatal error | |
| `/my-schedule` | BA | PASS — no blank screen, has nav, no fatal error | |
| `/my-requests` | PM_PO | PASS — no blank screen, has nav, no fatal error | |
| `/manager/inbox` | BA_MANAGER, ADMIN | PASS — no blank screen, has nav, no fatal error | |
| `/manager/dashboard` | BA_MANAGER, ADMIN | PASS — no blank screen, has nav, no fatal error | |
| `/crm/ba` | ALL | PASS — no blank screen, has nav, no fatal error | |
| `/crm/ba/:id` | ALL | PASS — no blank screen, has nav, no fatal error | |
| `/reports` | BA_MANAGER, ADMIN | PASS — no blank screen, has nav, no fatal error | |
| `/notifications` | ALL | PASS — no blank screen, has nav, no fatal error | |
| Unknown route → `/` | ALL | PASS — redirects to `/` | |

## Responsive

| Breakpoint | Result | Notes |
|---|---|---|
| 1920x1080 | PASS | Nav intact, no overflow |
| 1366x768 | PASS | Nav intact, no overflow |
| 1024x1366 (tablet portrait) | PASS | Nav intact, no overflow |
| 768x1024 (tablet) | PASS | Nav intact, no overflow |
| 390x844 (mobile) | PASS | No horizontal overflow on timeline |

## Error / empty / loading states

| Page | State | Result | Notes |
|---|---|---|---|
| Timeline | Loading | PASS | `LoadingScreen` spinner shown while fetching |
| Timeline | Error | PASS | `Could not load timeline data. Check API connection and retry.` |
| Timeline | Empty | PASS | BA rows render with 0 bookings gracefully |
| My Requests | Loading | PASS | `LoadingScreen` spinner shown while fetching |
| My Requests | Error | PASS | `Could not load requests. Check API connection and retry.` |
| My Requests | Empty | PASS | `No requests match the selected status.` |
| Manager Inbox | Loading | PASS | `LoadingScreen` spinner shown while fetching |
| Manager Inbox | Error | PASS | Error banner shown when API fails (`ManagerInboxPage.tsx:577-583`) |
| Manager Inbox | Empty | PASS | Renders empty state correctly |
| BA Directory | Loading | PASS | `LoadingScreen` spinner shown while fetching |
| BA Directory | Error | PASS | `Could not load BA directory. Check API connection and retry.` |
| BA Directory | Empty | PASS | Renders empty list gracefully |
| Reports | Loading | PASS | `LoadingScreen` spinner shown while fetching |
| Reports | Error | PASS | Error banner shown when API fails (`ReportsPage.tsx:93-95`) |
| Reports | Empty | PASS | Renders empty table gracefully |
| Notifications | Loading | PASS | `LoadingScreen` spinner shown while fetching |
| Notifications | Error | PASS | Error banner shown when API fails (`NotificationsPage.tsx:51-53`) |
| Notifications | Empty | PASS | Renders empty state |

## Lỗi đã fix

| Bug | File sửa | Verify |
|---|---|---|
| Playwright chưa cài trong project | `package.json`, `playwright.config.ts` | Chromium browser installed, 100 smoke tests pass |
| Thiếu e2e test infrastructure | `e2e/smoke.spec.ts`, `e2e/responsive.spec.ts`, `e2e/error-empty-loading.spec.ts` | Tests runnable via `pnpm test:e2e` |
| Database port conflict (5432) | `prisma.config.ts`, `prisma/seed.ts`, `apps/api/.env` | DB connects on port 5433 |
| ESLint warning — useMemo deps | `ReportsPage.tsx:37` | `rows` wrapped in `useMemo([report.data])` |

## Tổng kết

- **Tất cả route smoke: PASS**
- **Tất cả responsive breakpoints: PASS**
- **Tất cả error/empty/loading states: PASS** (13/13)
- **Không còn lỗi nào cần fix.**
