# Server split — plan and task list

Status: **complete (2026-11-12)**. Owner decision: the backend moves out of Next.js into a
dedicated **Express + Prisma + PostgreSQL** server; the Next.js app becomes a pure client that calls it.
This document is the contract every implementation task followed. The older docs (ARCHITECTURE §1–§7, §9, §10, §15, API_CONVENTIONS, DEPLOYMENT, OPERATIONS, SECURITY, the freeze docs) were updated in task T8; ARCHITECTURE §15 records the decisions below as D72–D79.

## 1. Decisions (from the owner)

| #   | Decision                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Three npm workspaces in this repo: `server/`, `client/`, `shared/`. Root `package.json` only orchestrates.                                                   |
| S2  | Server language: **TypeScript** (template file names, `.ts` extension). Express 5.                                                                           |
| S3  | Auth: **Bearer access token** (short JWT with `sid`) in client memory (Zustand), `Authorization: Bearer …`. Refresh token stays an httpOnly cookie, rotated. |
| S4  | **Redis with fallback**: `REDIS_URL` set → Redis caches; unset → in-process memory cache (short TTL). Dev and CI run without Redis.                          |
| S5  | Server modules keep `<feature>.repository.ts` (queries) and pure `<feature>.policy.ts` rules as service internals; business logic moves **unchanged**.       |
| S6  | Code used by both sides (Zod contracts, types, pure policies, permission catalog, money/date utils) lives in `shared/` (`@serene/shared/...`).               |
| S7  | Client keeps property-in-URL routing (`/[propertyCode]/<feature>`, `/organization/<feature>`) with the template's folder conventions.                        |
| S8  | Everything moves in one pass; old Next.js API routes are deleted at the end. No browser QA in this pass — typecheck, lint, tests and build are the gate.     |

Unchanged on purpose: API paths (`/api/v1/...` same URLs and methods), permission keys, business rules,
database schema except the additive migration in T3, append-only ledgers, property scope from the URL path.

## 2. Target layout

```text
package.json                 # workspaces: ["shared","server","client"]; scripts fan out (dev, verify…)
shared/                      # @serene/shared — isomorphic only: no Prisma, no node:*, no React, no "server-only"
  package.json  tsconfig.json
  modules/<domain>/<domain>.schema.ts | .types.ts | .policy.ts   (+ confirmation-number.policy, search.policy)
  lib/permissions/ (catalog, roles, evaluate)   lib/validation/   lib/utils/ (isomorphic ones)
  lib/i18n/   lib/auth/password-policy.ts   lib/realtime/topics.ts   types/api.ts
server/
  package.json  tsconfig.json  vitest.config.mts  eslint.config.mjs  .env.example
  app.ts                     # createApp(): middleware order, mounts every router under /api/v1
  index.ts                   # http server, graceful shutdown, optional inline worker
  config/env.ts              # validated env (was lib/env.ts) + new vars
  config/prisma.ts           # single Prisma client + pool (was lib/db/prisma.ts)
  prisma/                    # schema/, migrations/, seed/ ; prisma.config.ts at server root
  generated/                 # Prisma client output (gitignored)
  lib/
    customError.ts           # AppError(status, message, isOperational, code, details?) + appError(code,…) helper
    response.ts              # successResponse / errorResponse / normalizeError
    validate.ts              # validateBody / validateQuery / validateParams (zod)
    redis.ts  cache.ts       # Redis client (optional) + memory fallback; swr + single-flight helper
    session-cache.ts permission-cache.ts
    jwt.ts sessions.ts audit.ts client-ip.ts log.ts scope.ts
    db/ (transaction, pool-config, pool-metrics, read-replica, rate-limit-store)
    lifecycle/ observability/ realtime/ (hub, stream) jobs/ auth/password.ts
  middlewares/
    requestId.ts auth.ts (requireAuth) permission.ts (requirePermission, requireOrgPermission)
    propertyScope.ts rateLimit.ts idempotency.ts highRiskReason.ts sameOrigin.ts errorHandler.ts
  modules/<feature>/
    <feature>.routes.ts      # path + middleware + validator + controller (one Router per module)
    <feature>.validators.ts  # re-exports/extends zod schemas from @serene/shared for this module's routes
    <feature>.controller.ts  # thin: call service, successResponse, next(err)
    <feature>.service.ts  <feature>.repository.ts   (moved unchanged, imports rewritten)
    index.ts not used — app.ts imports each `<feature>.routes.ts`
  workers/worker.ts          # durable job worker, separate process (night audit)
  scripts/ops/ scripts/db/ scripts/load/
  tests/unit/ tests/db/ tests/integration/
client/
  package.json  tsconfig.json  next.config.ts  eslint.config.mjs  postcss.config.mjs  vitest.config.mts
  proxy.ts                   # CSP nonce + security headers only (no auth gating: tokens are not cookies)
  app/                       # same URL tree, minus app/api
    <route>/page.tsx  <route>/_components/  <route>/_hooks/  <route>/_lib/
  global/
    api/baseApi.ts           # fetchBaseQuery(NEXT_PUBLIC_API_URL), Bearer header, refresh-on-401 single-flight, retry 429/503
    api/endpoints/<feature>Api.ts   api/types/   api/errors.ts   api/store.ts
    components/              # was components/ (ui/, workspace/, rooms/, …)
    hooks/  lib/ (offline/, realtime client)  stores/ (auth.store.ts, realtime status, ui)
    constants/api.ts         # API base, tag types, permission keys `P.*`
  public/  tests/
```

Import specifiers: server `@/…` → `server/…`; client `@/…` → `client/…`; both import shared as
`@serene/shared/<path>` (package `exports: { "./*": "./*.ts" }`, Next `transpilePackages`).

## 3. Server conventions (template, adapted to TS)

Request flow per route:

```ts
router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/cancel",
  requireAuth, // Bearer JWT → session (cached) → req.ctx (SessionContext)
  propertyScope, // :propertyId uuid + canAccessProperty → req.ctx becomes PropertyContext (403 if not)
  requirePermission("reservations:cancel"),
  validateParams(reservationRoomParamsSchema),
  validateBody(cancelReservationSchema),
  requireReasonForHighRisk("reservations:cancel"),
  controller.cancel,
);
// controller: export const cancel = handle((req) => service.cancelReservation(req.ctx, req.params.reservationRoomId, req.body));
```

- Order in `app.ts`: requestId → helmet/security headers → cors(allowlist `CLIENT_ORIGINS`, credentials) → body
  limit 1 MiB JSON only → cookie-parser → global write limit (300/min per IP) → routers under `/api/v1` →
  health/metrics under `/api` → 404 → `errorHandler`.
- Every old route option maps 1:1: `permission` → `requirePermission`/`requireOrgPermission`,
  `params/query/body` → `validate*`, `idempotent: true|"optional"` → `idempotency({ required })` (sets
  `req.idempotency`), `rateLimit` → `rateLimit(rule)`, `status: 201` → `handle(fn, { status: 201 })`,
  `withMeta(data, meta)` → `successResponse` with `meta`.
- Envelope. Success: `{ success: true, message: "OK", data, meta? }`. Error:
  `{ success: false, message, error: { code, details?, requestId } }`. Status codes and error codes unchanged.
  Every response carries `x-request-id` and `cache-control: no-store`.
- `AppError(status, message, isOperational = true, code, details?)`; services keep throwing by code through
  `appError(code, message, details?)` (status from the existing code→status table). Non-operational errors are
  logged and answered as `INTERNAL_ERROR`.
- Services stay framework-free: they receive `ctx` and plain inputs, never `req`/`res`.
- Data scope: `lib/scope.ts` exports `propertyWhere(ctx)` / `organizationWhere(ctx)`; new or touched queries use it.
  Child-keyed queries listed in the analysis (billing, groups, reservations, rooms, rates repositories) gain the
  `propertyId` filter.
- Prisma: `select` the needed columns (no `include: true` on whole relations in new code), aggregate in SQL,
  batch instead of loops.
- Streaming routes (SSE `GET /properties/:id/events`, CSV exports, avatar image) write to `res` directly.

## 4. Auth (S3)

- `POST /auth/login` → `{ data: { accessToken, expiresIn, user } }` + sets refresh cookie (httpOnly,
  `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` in prod). No access cookie, no session-marker cookie.
- `POST /auth/refresh` (cookie) → new `accessToken` and rotated refresh cookie. Reuse detection unchanged.
- `POST /auth/logout` revokes the session and clears the cookie.
- **One active session per user per platform** (`X-Client-Platform: web | mobile`, default `web`): a new login
  revokes the user's other sessions on the same platform. New column `auth_sessions.platform` (T3 migration,
  named after `20261226090000`, e.g. `20261227090000_auth_session_platform`, default `'web'`).
- `requireAuth`: verify JWT (`sub`, `org`, `sid`) → session active? (session cache, TTL 30 s in Redis / 10 s
  in memory, deleted on logout, revoke, password change/reset, user status change) → grants (permission cache,
  invalidated on role grant/revoke and role-permission change). Reason codes on 401 (`SESSION_REVOKED`,
  `SESSION_EXPIRED`, `ACCOUNT_DISABLED`, …) so the client can show the server's message.
- CSRF: Bearer requests need no Origin check; the cookie endpoints (`/auth/refresh`, `/auth/logout`) keep the
  Origin check against `CLIENT_ORIGINS`.
- Realtime SSE is fetch-based, so it sends the Bearer header. Avatar image and CSV export are fetched with the
  header and turned into blob/object URLs on the client.

## 5. Client conventions

- RTK Query only; one `baseApi`; `injectEndpoints` per feature in `global/api/endpoints/<feature>Api.ts`; no
  `fetch` in components (the auth store's boot refresh and the SSE client live in `global/`).
- `global/stores/auth.store.ts` (Zustand): `accessToken`, `expiresAt`, `status` (`booting|authenticated|anonymous`).
  On app boot: call refresh once (cookie) → token or anonymous. `baseApi` adds the header, single in-flight
  refresh on 401, retry with backoff on 429/503, redirect to `/login?reason=<code>` with the server message.
- Server Components no longer read the session. `(workspace)/layout.tsx` becomes the client auth guard
  (boot → `useMeQuery` → render shell or redirect). `[propertyCode]/layout.tsx` and the organization guards
  resolve access from `useMeQuery` on the client; `app/page.tsx` redirect becomes client-side.
- `usePermissions().has("x:y")` + `<PermissionGate permission="x:y">` around pages; UI only, never security.
- Filters live in the URL (existing behaviour kept); forms keep Zod from `@serene/shared`.
- Offline snapshot and `verifySession` keep working through the new auth store.

## 6. Environment

Server `.env`: existing vars (`DATABASE_URL`, auth secrets, pool, jobs, realtime, metrics…) plus `PORT`
(4000), `CLIENT_ORIGINS` (comma list, default `http://localhost:3000`), `REDIS_URL` (optional),
`SESSION_CACHE_TTL_MS`, `PERMISSION_CACHE_TTL_MS`. `APP_URL` is replaced by `CLIENT_ORIGINS` for CSRF.
Client `.env.local`: `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api/v1`). Deploy order: migrate →
server → client.

## 7. Tasks

| Task  | Owner     | Depends on | Scope                                                                                                                                                                                                                                                                               |
| ----- | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1    | Sonnet    | —          | Workspaces + file moves (`git mv`) into `shared/`, `server/`, `client/`; rewrite imports; old `app/api` parked at `server/_legacy-routes/` (excluded from tsc/lint) as the conversion reference. Each package typechecks except parked code and integration tests.                  |
| T2    | Sonnet    | T1         | Server foundation: install deps; `app.ts`, `index.ts`, `config/*`, every `lib/*` and `middlewares/*` above; error/response/validate; Redis + memory caches; health/metrics; integration test harness on supertest; stub router per module mounted in `app.ts`.                      |
| T3    | (merged)  | —          | Folded into T2 (auth core: Bearer login/refresh/logout, `me`, sessions per platform + migration, session/permission caches) and T4d (`users`, `roles` routes), because every T4 task needs a working login for its tests. T2 also converts `business-date` as the reference module. |
| T4a–e | Sonnet ×5 | T2         | Convert legacy routes → `routes/validators/controller` per module, delete each parked route file once converted, convert that module's integration tests. Split below.                                                                                                              |
| T5    | Sonnet    | T1         | Client: folder conventions, `global/`, auth store, Bearer `baseApi`, client-side guards, SSE/avatar/CSV through the header, envelope parsing, `PermissionGate`, `constants/api.ts`.                                                                                                 |
| T6    | Sonnet    | T2         | Worker (`workers/worker.ts`) and ops scripts: dry-run by default (`--apply --yes`), wrong-database guard, kill switch; esbuild build for server + worker + ops.                                                                                                                     |
| T7    | Opus      | all        | Integration: delete `_legacy-routes`, root scripts, CI workflow, run `npm run verify` and integration tests against native PostgreSQL, fix breakages.                                                                                                                               |
| T8    | Sonnet    | T7         | Docs: README, ARCHITECTURE (§1–§7, §15 new decisions S1–S8), DEPLOYMENT, `.env.example` files, this file's status.                                                                                                                                                                  |

T4 split (disjoint folders):

- **T4a** reservations, availability, rates (incl. packages, rate plans, restrictions), groups
- **T4b** front-desk, rooms, housekeeping, maintenance, realtime (SSE)
- **T4c** billing (folios, payments), night-audit, jobs
- **T4d** guests, accounts, loyalty, search, audit, users, roles
- **T4e** properties (incl. setup copy, configuration), setup, organization, reports (incl. CSV export), dashboard

## 8. Definition of done

`npm run verify` at the root (typecheck, lint, unit + db tests, server build, client build) passes; integration
tests pass against the local `serene_management_test` database; no file under `client/` imports server code;
no file under `shared/` imports Prisma, `node:*`, React or `server-only`; every old route path answers on the
Express server with the same method, permission and validation; no secrets committed.

## 9. Outcome

All tasks T1–T8 are done (T3 was merged into T2/T4d as planned). The backend runs as an Express 5 server under `server/`, the client under `client/` is a pure client of it, shared contracts live in `shared/`, the old `app/api` routes and the parked `_legacy-routes` were deleted, and the docs were updated (ARCHITECTURE D72–D79 mirror S1–S8).

Verification (2026-11-12, root `npm run verify` against a throwaway local PostgreSQL 18): typecheck and lint
clean in all three workspaces; server unit + database-rule tests 309/309; client unit tests 114/114;
integration tests 455/455 (37 files); server, worker and ops bundles built; `next build` of the client passed.
No browser QA was done in this pass (owner's choice).

Beyond the plan:

- New migration `20261227090000_auth_session_platform` (`auth_sessions.platform`, default `'web'`). Folders are dated ahead of the calendar: new migrations must be named after it.
- The server also reads a repository-root `.env` as a fallback to `server/.env`. `APP_URL` is gone (replaced by `CLIENT_ORIGINS`).
- Operator scripts are dry runs by default (`--apply --yes --database <name>`, or `OPS_EXPECTED_DATABASE`); `ops:bootstrap --confirm` is a deprecated alias. The worker runs as `node dist/workers/worker.mjs` (`npm run worker`); `--conditions=react-server` is no longer needed; `JOB_WORKER=off` applies per process.

Known follow-ups:

- The Redis path (`REDIS_URL`) has not been exercised locally: development and tests run on the memory fallback.
- Browser QA was not done in this pass (S8); only typecheck, lint, tests and builds gate it.
- The development `.env` still sits at the repository root and must move to `server/.env`; its database credentials currently fail on this machine and need to be corrected before running the server or integration tests locally.
- The two-process deployment layouts in DEPLOYMENT.md §11 (nginx, HAProxy, systemd) were written for the split and have not been run on a host; the v1.0.0-rc1 rehearsal (DEPLOYMENT §12) predates the split.
