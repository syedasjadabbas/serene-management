@AGENTS.md

# SERENE MANAGEMENT — agent instructions

Hotel PMS. The engineering contract is `docs/SERENE_MANAGEMENT_DEVELOPMENT_GUIDE.md`; the architecture baseline is `docs/ARCHITECTURE.md` (read §3 dependency rules and §15 decisions before changing structure). The split into Express server, Next.js client and shared package is described in `docs/SERVER_SPLIT_PLAN.md` (decisions D72–D79).

Layout: npm workspaces `shared/` (`@serene/shared`: Zod contracts, types, pure policies, permission catalog, utils), `server/` (Express 5 API, Prisma, worker, ops scripts, tests) and `client/` (Next.js 16, a pure client of the API). `client` and `server` never import each other; both import `shared`. `@/…` means `server/…` inside `server/` and `client/…` inside `client/`.

Non-negotiables:

- Server routes stay thin. A route is `server/modules/<feature>/<feature>.routes.ts`: `requireAuth` → `propertyScope` → `requirePermission` → `validate*` → controller (`<feature>.controller.ts`), which calls one service function and returns the envelope. Business logic lives in `<feature>.service.ts`, data access in `<feature>.repository.ts`, pure rules/state machines in `shared/modules/<domain>/<domain>.policy.ts`. Services never see `req`/`res`.
- Property scope comes only from the URL path and `ctx.propertyId`; every property-scoped query filters by it (`propertyWhere(ctx)` / `organizationWhere(ctx)` in `server/lib/scope.ts`).
- Anything used by both sides (Zod schemas, types, policies, permission catalog, money/date utils) lives in `shared/` and is imported as `@serene/shared/<path>`. `shared/` imports no Prisma, `node:*`, React or `server-only`.
- Client server-data lives in RTK Query (single `client/global/api/baseApi.ts`, `injectEndpoints` per feature in `client/global/api/endpoints/<feature>Api.ts`); Zustand is for UI state and the in-memory access token only. No `fetch` in components.
- Auth is a Bearer access token (client memory) plus an httpOnly refresh cookie; the server is the only authority, client guards and `PermissionGate` are UI conveniences.
- Route-local client code stays in its route folder (`_components`, `_hooks`, `_lib`); promote to `client/global/` only when a second route needs it.
- API envelope: success `{ success, message, data, meta? }`, error `{ success: false, message, error: { code, details?, requestId } }`. API paths, methods and permission keys are stable.
- Money: `numeric(19,4)` + currency, decimal strings on the wire, never JS floats. Business/stay dates are `YYYY-MM-DD` strings.
- Ledgers (`folio_items`, `audit_logs`, `room_status_history`, `cash_movements`) are append-only; corrections are new rows.
- Every schema change needs a migration under `server/prisma/migrations`; rules Prisma cannot express go into a hand-written migration and `docs/DATABASE_DESIGN.md` §5. Migration folders are dated ahead of the calendar: name a new one with a timestamp later than the latest existing folder (currently after `20261227090000`), not today's date.
- New permissions go into `shared/lib/permissions/catalog.ts` and the relevant role templates.
- Before declaring work done: `npm run verify` (typecheck, lint, unit tests, integration tests, build). The integration tests need the native PostgreSQL `serene_management_test` database.
- Run tools via the npm scripts (they call `node node_modules/...` because the repo path contains `&`, which breaks npm's Windows shims). Two dev processes: `npm run dev:server` (API, port 4000) and `npm run dev:client` (port 3000).
- Operator scripts (`ops:seed`, `ops:bootstrap`, `ops:maintenance`) are dry runs by default; writing needs `--apply --yes --database <name>`. They run compiled output, so `npm run build` first. The job worker is `npm run worker`; `JOB_WORKER=off` applies per process.
- Development database is a **native PostgreSQL** installation (no Docker). `npm run db:setup` creates the app role and databases from `DATABASE_URL` in `server/.env`; never commit `.env` files. Client config is `client/.env.local` (`NEXT_PUBLIC_API_URL`).
