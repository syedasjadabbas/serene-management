# SERENE MANAGEMENT — AI MEMORY FREEZE

## Canonical State

SERENE MANAGEMENT is a hotel PMS built from scratch, functionally inspired by enterprise PMS workflows such as Oracle Hospitality OPERA, without copying proprietary code/UI/assets/text.

- **Phase:** 10 complete
- **Commit:** `7129881`
- **Tag:** `phase-10-complete`
- **Branch:** `main`
- **Repo:** https://github.com/syedasjadabbas/serene-management

## Completed

Phases 0–10 are complete:
1. Foundation
2. Auth/RBAC/Organization
3. Reservations/Availability
4. Front Desk
5. Rooms/Housekeeping/Maintenance
6. Folios/Billing/Payments
7. Rates/Packages/Groups
8. Guests/Companies/Loyalty
9. Reports/Night Audit/Finance
10. Multi-property/Organization
11. Production readiness/security/performance/accessibility/CI/backups

Final validation: 51 test files, 668 tests, typecheck/lint/build passed, CI passed, migration/drift clean, browser verification completed, backup/restore drill completed, working tree clean and pushed.

## Stack

Next.js 16, React 19, TypeScript, Tailwind v4, PostgreSQL 18.6, Prisma, Zustand, Redux Toolkit + RTK Query, Zod, JWT/session auth, Next.js `proxy.ts`.

**No Docker.** Local DB is native PostgreSQL 18.6 on localhost:5432.

## Architecture

- `app/(auth)` auth
- `app/(workspace)/[propertyCode]/...` property workspace
- `app/(workspace)/organization/...` organization workspace
- `app/api/v1/**` thin API handlers
- `modules/<domain>/` domain/business logic

Property access and API route wrappers are server-enforced.

## Change Control

AI/coding agents must not commit, tag, push, or rewrite Git history.

Do not modify applied migrations. New schema changes require new migrations.

## Deferred, Not Missing

Payment/POS integrations, email/SMS delivery, outbox worker, Redis/distributed rate limiting, SSE, OAuth/SSO, external hotel integrations, advanced accounting, FX/multi-currency, cross-property/shared inventory and similar integrations are intentionally deferred.

Do not add infrastructure without a concrete requirement.

## Next Order

**UI/UX overhaul → real-world hotel workflow refinement → final production validation**

UI/UX must preserve the established architecture, business rules, RBAC and security boundaries.

After UI/UX, use realistic hotel workflows to find missing workflows, edge cases, business-rule gaps and operational friction. Fix those, then perform final production validation.

## Freeze Rule

Treat `phase-10-complete` / `7129881` as the canonical baseline. Do not restart completed phases or redesign architecture without a concrete reason.
