@AGENTS.md

# SERENE MANAGEMENT — agent instructions

Hotel PMS. The engineering contract is `docs/SERENE_MANAGEMENT_DEVELOPMENT_GUIDE.md`; the architecture baseline is `docs/ARCHITECTURE.md` (read §3 dependency rules and §15 decisions before changing structure).

Non-negotiables:

- Route handlers (`app/api/v1/**/route.ts`) stay thin: authenticate → authorize → validate → call a service → respond. Business logic lives in `modules/<domain>/*.service.ts`, data access in `*.repository.ts`, pure rules/state machines in `*.policy.ts`.
- Property scope comes only from the URL path and `ctx.propertyId`; every property-scoped query filters by it.
- Server data lives in RTK Query (single `lib/api/baseApi.ts`, `injectEndpoints` per domain); Zustand is for UI state only.
- Route-local code stays in its route folder; promote to global folders only when a second route needs it.
- Money: `numeric(19,4)` + currency, decimal strings on the wire, never JS floats. Business/stay dates are `YYYY-MM-DD` strings.
- Ledgers (`folio_items`, `audit_logs`, `room_status_history`, `cash_movements`) are append-only; corrections are new rows.
- Every schema change needs a migration; rules Prisma cannot express go into a hand-written migration and `docs/DATABASE_DESIGN.md` §5.
- New permissions go into `lib/permissions/catalog.ts` and the relevant role templates.
- Before declaring work done: `npm run verify` (typecheck, lint, tests, build).
- Run tools via the npm scripts (they call `node node_modules/...` because the repo path contains `&`, which breaks npm's Windows shims).
