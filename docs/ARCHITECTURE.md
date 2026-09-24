# SERENE MANAGEMENT — Architecture

Status: **Phase 0 (architecture) — accepted baseline.**
Source of truth: [`SERENE_MANAGEMENT_DEVELOPMENT_GUIDE.md`](./SERENE_MANAGEMENT_DEVELOPMENT_GUIDE.md) ("the Guide").
Where this document refines or deviates from the Guide, it is listed in [§15 Decisions that refine the Guide](#15-decisions-that-refine-the-guide).

Companion documents:

| Document                                                 | Contents                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md)                     | Bounded contexts, entities, relationships, state machines                        |
| [DATABASE_DESIGN.md](./DATABASE_DESIGN.md)               | PostgreSQL/Prisma conventions, tables, keys, indexes, integrity rules            |
| [PMS_WORKFLOWS.md](./PMS_WORKFLOWS.md)                   | Every hotel workflow: entities, changes, rules, permissions, audit, transactions |
| [API_CONVENTIONS.md](./API_CONVENTIONS.md)               | HTTP contract, validation, errors, pagination, idempotency                       |
| [RBAC.md](./RBAC.md)                                     | Permissions, roles, property-level access, enforcement                           |
| [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md) | Phases, dependency order, exit criteria                                          |

---

## 1. System overview

SERENE MANAGEMENT is a multi-property hotel PMS. It is one Next.js 16 application with a strict internal split:

```text
 Browser (React 19, RTK Query cache, Zustand UI state)
    │  HTTPS, JSON, httpOnly auth cookies
    ▼
 proxy.ts ── optimistic route gating (JWT signature/expiry only, no DB)
    │
 app/api/v1/**/route.ts ── thin HTTP adapters: authenticate → authorize → validate → call service → respond
    │
 modules/<domain>/*.service.ts ── use cases, business rules, state machines, transactions, audit, events
    │
 modules/<domain>/*.repository.ts ── Prisma queries (select shapes, raw SQL for reports)
    │
 PostgreSQL 18 ── constraints, exclusion constraints, triggers = last line of defence
```

Principles, in priority order:

1. **Correct hotel workflows first.** A workflow is complete only when persistence, validation, permissions, audit, inventory, billing and dependent modules are all handled (Guide §52–55).
2. **The server is the authority.** UI checks are convenience; route handlers and services re-check everything. The database re-checks the most important invariants.
3. **Property isolation by construction.** Property comes from the URL, is authorized per request, is required by every property-scoped service call, and is enforced by composite foreign keys.
4. **Ledgers are append-only.** Financial postings, audit logs and status history are never updated or deleted.
5. **Simple and explicit.** One abstraction per real need. No generic repositories, no event-sourcing framework, no DI container.

## 2. Final project structure

```text
serene-management/
├── app/                                  # Next.js App Router (UI routes + HTTP API)
│   ├── layout.tsx                        # <html lang dir>, fonts, Providers
│   ├── providers.tsx                     # Redux (RTK Query) provider — client
│   ├── globals.css                       # design tokens + Tailwind v4 theme
│   ├── (auth)/                           # Phase 1: login, forgot/reset password (public)
│   │   ├── layout.tsx
│   │   └── login/ …
│   ├── (workspace)/                      # Phase 1+: authenticated shell
│   │   ├── layout.tsx                    # session check (server), app frame, command menu
│   │   ├── organization/                 # org admin: users, roles, properties, profiles config
│   │   └── [propertyCode]/               # everything property-scoped
│   │       ├── layout.tsx                # resolves property, checks access, business date bar
│   │       ├── dashboard/
│   │       ├── front-desk/               # arrivals, departures, in-house, room rack, queue
│   │       ├── reservations/
│   │       ├── availability/
│   │       ├── guests/
│   │       ├── accounts/                 # companies, travel agents, sources
│   │       ├── groups/
│   │       ├── rooms/                    # room setup, OOO/OOS, holds
│   │       ├── housekeeping/
│   │       ├── maintenance/
│   │       ├── billing/                  # folios, postings, routing, invoices
│   │       ├── cashiering/               # cashier shifts, payments, refunds, deposits
│   │       ├── night-audit/
│   │       ├── reports/
│   │       └── settings/                 # property configuration & code tables
│   └── api/v1/                           # route handlers (thin)
│       ├── auth/…                        # login, refresh, logout, password reset
│       ├── me/…
│       ├── guests/…  accounts/…  users/… # organization-scoped resources
│       └── properties/[propertyId]/…     # property-scoped resources and commands
├── components/ui/                        # design-system primitives (shared by ≥2 routes)
├── hooks/                                # shared hooks: usePermissions, useProperty, useBusinessDate
├── lib/                                  # shared infrastructure
│   ├── api/        baseApi.ts, store.ts  # RTK Query base + Redux store factory (client)
│   ├── auth/                             # Phase 1: jwt, cookies, password hashing (server-only)
│   ├── db/         prisma.ts             # PrismaClient + Tx type (server-only)
│   ├── http/       errors.ts, response.ts, route.ts (Phase 1)   # server-only
│   ├── permissions/ catalog.ts, roles.ts, evaluate.ts           # isomorphic
│   ├── validation/ common.ts             # shared Zod primitives (isomorphic)
│   ├── i18n/       config.ts, messages/  # locales, direction
│   ├── env.ts                            # validated server env (server-only)
│   └── utils/                            # isomorphic helpers (dates, money formatting)
├── modules/                              # domain layer — one folder per bounded context
│   └── <domain>/
│       ├── <domain>.schema.ts            # Zod API contracts          (isomorphic)
│       ├── <domain>.types.ts             # DTO / view types           (isomorphic)
│       ├── <domain>.policy.ts            # pure rules, state machines (isomorphic, unit-tested)
│       ├── <domain>.service.ts           # use cases + transactions   (server-only)
│       └── <domain>.repository.ts        # Prisma data access         (server-only)
├── store/          ui.store.ts           # global Zustand stores (UI state only)
├── types/          api.ts                # wire envelope, error codes
├── prisma/
│   ├── schema/*.prisma                   # multi-file schema, one file per domain
│   ├── migrations/                       # generated + hand-written constraint migrations
│   └── seed/                             # reference data (+ demo data behind SEED_DEMO)
├── tests/          unit/ db/ integration/ e2e/ support/
├── docs/
├── proxy.ts                              # Phase 1: optimistic auth gating + CSP nonce
├── scripts/db/                           # native PostgreSQL bootstrap (role + databases), no Docker
└── prisma.config.ts, next.config.ts, eslint.config.mjs, vitest.config.mts, tsconfig.json
```

Domain modules (created as their phase starts, never ahead of time):

| Module                            | Bounded context                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `identity`                        | users, sessions, password reset                                                  |
| `access`                          | roles, permissions, property access resolution                                   |
| `properties`                      | organization, property, configuration, buildings, floors, code tables, sequences |
| `business-date`                   | current date, date roll (used by every posting)                                  |
| `rooms`                           | room classes/types, rooms, features, connections, status, OOO/OOS, holds         |
| `profiles`                        | guests, accounts (company/agent/source), preferences, documents, merge           |
| `rates`                           | rate categories, rate plans, seasons, derived rates, policies, packages          |
| `availability`                    | inventory counters, restrictions, availability search                            |
| `reservations`                    | bookings, reservation rooms, nights, notes, traces, deposits requests, turnaways |
| `room-assignment`                 | assign / auto-assign / move / swap / upgrade, conflict detection                 |
| `front-desk`                      | check-in, check-out, walk-in, queue, messages, wake-up calls                     |
| `billing`                         | transaction codes, taxes, folios, posting engine, routing, invoices              |
| `payments`                        | payment methods, instruments, payments, refunds, authorizations, deposits ledger |
| `cashiering`                      | cashier shifts, cash movements, reconciliation                                   |
| `housekeeping`                    | tasks, sheets, attendants, inspections, discrepancies, lost & found              |
| `maintenance`                     | requests, activities, preventive plans                                           |
| `night-audit`                     | audit runs, steps, statistics snapshot                                           |
| `groups`                          | groups, blocks, allocations, rooming lists                                       |
| `commissions`, `loyalty`, `stock` | modular add-ons (Phase 12)                                                       |
| `reports`                         | report queries and exports (SQL aggregation)                                     |
| `audit`                           | audit log writer/reader (used by all modules)                                    |
| `events`                          | transactional outbox writer, SSE relay                                           |

## 3. Layering and dependency rules

| Layer                                                          | May import                                                                                                                                                             | Must not import                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| UI (`app/**` pages/layouts, `components/`, `hooks/`, `store/`) | `lib/api`, `lib/permissions`, `lib/validation`, `lib/i18n`, `lib/utils`, module contracts (`modules/<domain>/<domain>.schema.ts`, `.types.ts`, `.policy.ts`), `types/` | services, repositories, `lib/db`, `lib/http`, `lib/auth` server code, `generated/prisma`      |
| Route handlers (`app/api/**`)                                  | `lib/http`, `lib/auth`, services, schemas                                                                                                                              | repositories, `lib/db`                                                                        |
| Services                                                       | own repository, other modules' **services** (never their repositories), `lib/db` (for `$transaction`), audit/events                                                    | UI code, `next/*` request APIs                                                                |
| Repositories                                                   | `lib/db`, generated Prisma types                                                                                                                                       | other repositories' tables that belong to another module (call that module's service instead) |
| Policies                                                       | nothing server-side; pure functions                                                                                                                                    | Prisma, I/O                                                                                   |

Enforcement:

- ESLint `no-restricted-imports` rules in `eslint.config.mjs` (verified to fail on a UI → `lib/db` import).
- Every server-only file starts with `import "server-only"`, so a leaked import also fails the build.
- Composite foreign keys in PostgreSQL make cross-property references impossible at the data level.

**Cross-module calls.** A service may call another module's service within the same transaction by passing the `tx` handle (`Tx` from `lib/db/prisma.ts`). Example: `frontDesk.checkIn` → `roomAssignment.assert…(tx)`, `billing.openFolio(tx)`, `rooms.setFrontOfficeStatus(tx)`. There is no event-driven choreography for in-process workflows; events (outbox) exist only for side effects outside the transaction (real-time push, integrations, emails).

## 4. Request lifecycle (server)

Every route handler follows the Guide §39 order through one small helper, `defineRoute` (Phase 1, `lib/http/route.ts`):

```ts
// app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/cancel/route.ts
export const POST = defineRoute({
  permission: "reservations:cancel", // 2. authorize (property from path)
  params: reservationRoomParamsSchema, // 3. validate
  body: cancelReservationSchema,
  idempotent: true, //    Idempotency-Key required
  handler: ({ ctx, params, body }) =>
    // 4. call service
    reservationsService.cancel(ctx, params.reservationRoomId, body),
}); // 5. structured response / error envelope
```

`defineRoute` does, in order:

1. Assigns `requestId` (from `x-request-id` or new UUIDv7).
2. **Authenticates**: verifies the access-token cookie (JWT, `jose`), loads the user's access profile (one indexed query).
3. **Scopes**: reads `propertyId` from the path, asserts `canAccessProperty`, loads the property's current business date and timezone.
4. **Authorizes**: `hasPermission(access, propertyId, permission)`; high-risk permissions additionally require a reason in the body.
5. **Validates** params, query and body with Zod; rejects unknown fields (`strict`).
6. For state-changing methods: checks `Origin` (CSRF), rate limits, idempotency key.
7. Calls the service with a `RequestContext`:

```ts
interface RequestContext {
  requestId: string;
  userId: string;
  organizationId: string;
  propertyId: string; // authorized, never taken from the body
  businessDate: string; // "YYYY-MM-DD", property's current business date
  timezone: string; // IANA zone of the property
  ip?: string;
  userAgent?: string;
}
```

8. Maps the result to `{ data, meta }` or any error to `{ error: { code, message, details, requestId } }` (`lib/http/response.ts`).

Services never read cookies, headers or the URL; they are callable from tests, jobs and the night audit with an explicit context.

## 5. Transactions, locking and concurrency

- **Unit of work = one service command = one `prisma.$transaction`** (interactive, `ReadCommitted`). Everything a workflow changes — including the audit record and outbox event — commits or rolls back together (Guide §40).
- **Explicit row locks** on contention points, always taken in a fixed order to avoid deadlocks:
  1. `business_dates` row of the property (`FOR SHARE` for postings, `FOR UPDATE` for night audit)
  2. `room_type_inventory` rows, ordered by `(room_type_id, stay_date)` (`FOR UPDATE`)
  3. `block_allocations` rows, same order
  4. `reservation_rooms` / `rooms` rows being transitioned (`FOR UPDATE`)
  5. `folios` rows being posted to, ordered by id (`FOR UPDATE`)
  6. `property_sequences` row last (short hold)
- **Optimistic concurrency** for user edits: mutable aggregates carry `version`; updates use `WHERE id = $1 AND version = $2` and return `409 CONFLICT (STALE_VERSION)` when nothing matched.
- **Database guards** catch what slips through: the exclusion constraint on `room_assignments` (no double-booked room), unique partial indexes (one current business date, one open cashier shift per user, one running night audit), check constraints, append-only triggers.
- **Retries**: a command that fails with a serialization/deadlock error (`P2034` / `40001` / `40P01`) is retried up to 3 times with jitter by the transaction helper; business errors are never retried.
- **Idempotency**: payments, postings, check-in, check-out, night audit require an `Idempotency-Key`; the stored response is replayed on retry (`idempotency_keys`).

## 6. Business date and time

- The **business date** (`business_dates`, one current row per property) is the hotel's accounting day. It advances only through night audit. Every posting, payment, status change and report uses it, never `new Date()` (Guide §30).
- **Instants** are stored as `timestamptz` (UTC). **Stay dates and business dates** are `date` columns and travel as `"YYYY-MM-DD"` strings — never converted through JavaScript `Date` in business logic.
- Each property has an IANA `timezone`. Conversion to local time happens only at the display boundary (UI) and when interpreting local wall-clock policies (cancellation deadline "18:00 local", ETA).
- While a night audit is running, the business date is `IN_AUDIT` and posting commands fail with `423 BUSINESS_DATE_LOCKED`.

## 7. Frontend architecture

### 7.1 Routing and layouts

- `app/(auth)` — public pages (login, password reset). Minimal layout.
- `app/(workspace)` — authenticated frame. The layout verifies the session server-side and renders the shell (navigation, top bar with property switcher, business date, global search, user menu).
- `app/(workspace)/[propertyCode]/…` — every property-scoped screen. The **selected property lives in the URL**, so deep links, browser tabs on different properties and RTK Query cache keys are all property-correct. The layout resolves `propertyCode → propertyId` from the `me` payload and renders a permission-denied state if the user lacks access.
- `app/(workspace)/organization/…` — organization-wide administration (users, roles, properties, profile configuration).
- Reserved segment names (`organization`, `api`, `login` …) are rejected as property codes by validation.

### 7.2 Route-local colocation (Guide §33)

Everything belonging to one route stays inside that route:

```text
app/(workspace)/[propertyCode]/reservations/
├── page.tsx                      # composes components; no business logic
├── [reservationId]/page.tsx
├── new/page.tsx
├── components/                   # ReservationSearchPanel, ReservationSummary, NightsGrid …
├── hooks/                        # useReservationFilters …
├── lib/
│   ├── reservations.api.ts       # baseApi.injectEndpoints({ … })
│   └── reservations.schema.ts    # form schemas composed from modules/reservations/*.schema.ts
├── store/                        # route-local Zustand (e.g. multi-step booking draft)
├── utils/
└── types.ts
```

Promotion rule (Guide litmus test): code moves to a global folder only when a **second route** needs it:

| Needed by 2+ routes | Promote to                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UI component        | `components/ui/` (primitive) or `components/<domain>/` (e.g. `components/reservations/ReservationStatusBadge.tsx`) |
| Hook                | `hooks/`                                                                                                           |
| RTK Query endpoints | `lib/api/endpoints/<domain>.api.ts`                                                                                |
| Zod contract        | already in `modules/<domain>/<domain>.schema.ts`                                                                   |
| Types               | `types/` or the module's `*.types.ts`                                                                              |

Components stay below ~250 lines; pages compose; business rules live in `modules/*/policy` (shared with the server) or on the server.

### 7.3 State

| Kind of state   | Tool                                                           | Examples                                                                             |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Server data     | **RTK Query** (single `baseApi`, `injectEndpoints` per domain) | reservations, rooms, folios, availability, reports, users                            |
| Client/UI state | **Zustand**                                                    | sidebar, command menu, selected rows, open drawers, multi-step drafts, table density |
| URL state       | search params                                                  | filters, sort, page, selected date range (shareable)                                 |
| Form state      | React Hook Form + Zod resolver (recommended, see §16)          | reservation form, check-in form                                                      |

Rules:

- Server records never go into Zustand (Guide §36). A Zustand store may hold **ids** (selected reservation ids), never copies of records.
- Every parameter that changes a result is part of the RTK Query argument (so of the cache key): property id, filters, date range, cursor.
- Tags: `providesTags` per entity (`{ type: "Reservation", id }`) plus list tags (`{ type: "Reservation", id: "LIST" }`); mutations invalidate precisely.
- Real-time events (§10) translate into `baseApi.util.invalidateTags`.
- Optimistic updates only for low-risk, reversible UI-local changes (e.g. housekeeping task progress), never for money or inventory.
- The Guide's `store/auth.store.ts` and `store/property.store.ts` are intentionally **not** created: the session user comes from `GET /me` (server data → RTK Query) and the selected property is in the URL.

### 7.4 Error, loading and permission states

Every data view renders five states: loading (skeleton matching layout), empty (with next action), error (message + retry + `requestId`), permission denied (explains which permission is missing), and data. Mutations show inline field errors from `VALIDATION_FAILED.details.fields` and toast business-rule errors by `code`.

## 8. Design system foundation

Implemented tokens: `app/globals.css`. Components are built in Phase 1 onward in `components/ui/`.

**Direction**: premium, calm, operational. Deep pine (`--sm-brand`) as the single brand color, brass (`--sm-accent`) reserved for recognition (VIP, loyalty), neutral ink surfaces, color used for status and action — not decoration. No gradients, no oversized KPI numbers, small radii (2–6 px), near-flat elevation.

| Area                  | Decision                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typography            | IBM Plex Sans (Latin) + IBM Plex Sans Arabic (Arabic/Urdu script) + IBM Plex Mono (confirmation numbers, codes). Tabular figures globally. Scale: 11 / 12 / **13 (table body)** / 14 (body) / 16 / 18 / 22 px. Weights 400/500/600 only.                                       |
| Spacing               | 4 px grid. Dense defaults: 32 px rows and controls; `data-density="touch"` switches to 44 px for housekeeping/maintenance tablets.                                                                                                                                             |
| Colors                | Three layers: raw palette → semantic `--sm-*` tokens (light + dark) → Tailwind theme (`bg-surface`, `text-fg-muted`, `border-subtle`, `bg-status-vacant-dirty` …). Dark theme included (night shift).                                                                          |
| Surfaces              | `canvas` (app background), `surface` (panels), `surface-sunken` (wells, table headers), `surface-raised` (popovers), `overlay` (dialog scrim).                                                                                                                                 |
| Borders               | `border-subtle` (dividers), `border` (inputs), `border-strong` (focus-adjacent emphasis). 1 px.                                                                                                                                                                                |
| Status colors         | Room: vacant-clean, vacant-dirty, occupied-clean, occupied-dirty, inspected, pickup, OOO, OOS, hold. Reservation: reserved, due-in, in-house, due-out, checked-out, cancelled, no-show, waitlisted. **Always paired with a text code or icon** (color-blind safe, print safe). |
| Buttons               | Variants: primary (brand), secondary (outlined), ghost, danger; sizes sm (28) / md (32) / touch (44). One primary per region. Keyboard shortcut hints via `Kbd`.                                                                                                               |
| Inputs / selects      | 32 px, label above, help/error below, `aria-describedby` wiring; combobox with async search for profiles, rooms, codes.                                                                                                                                                        |
| Tables / DataTable    | Headless table (TanStack Table recommended) + virtualization (TanStack Virtual) for large lists; sticky header, column resize/visibility, keyboard row navigation, row selection, server-side sort/filter/pagination only.                                                     |
| Dialogs / drawers     | Dialog for short decisions (cancel reason, confirm refund); right-side drawer (RTL-aware: logical `inset-inline-end`) for contextual detail (reservation, folio) without leaving the list. Focus trap, `Esc`, return focus.                                                    |
| Tabs                  | For record detail (reservation: Stay · Billing · Guests · History). URL-synced.                                                                                                                                                                                                |
| Badges / status pills | Code + color (`VD`, `OC`, `DI`, `IH`). Size 11 px.                                                                                                                                                                                                                             |
| Tooltips              | Supplementary only; never the sole carrier of information.                                                                                                                                                                                                                     |
| Date pickers          | Business-date aware (past dates disabled where appropriate), range picker for stays showing nights count, keyboard entry of dates, RTL/locale-aware calendars.                                                                                                                 |
| Command / search      | `Ctrl/Cmd + K` global command menu: search guests, confirmations, rooms, companies, groups, folios; jump to routes; run actions allowed by permissions.                                                                                                                        |
| Split panels          | List + detail layouts for front desk, housekeeping, billing.                                                                                                                                                                                                                   |
| Grids                 | Room rack (rooms × dates) and availability grid (room types × dates) as virtualized grids with sticky axes.                                                                                                                                                                    |

**Accessibility**: WCAG 2.2 AA — visible focus ring (`--sm-focus`), semantic tables, labelled controls, accessible dialogs, reduced-motion respected globally, contrast-checked status colors.

**Localization**: `lang`/`dir` on `<html>` from the user locale; layouts use logical properties (`ms-*`, `me-*`, `ps-*`, `start-*`); all strings from `lib/i18n/messages/<locale>.json`; services return codes, never display text (Guide §32).

## 9. Security architecture

| Concern            | Design                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication     | Email + password. Access token = short-lived JWT (HS256 via `jose`, 15 min; claims `sub`, `org`, `sid`); refresh token = 256-bit opaque random value, stored only as SHA-256 in `auth_sessions`, 14 days, **rotated on every refresh** with reuse detection (presenting a previous token revokes the session).                                           |
| Token transport    | `httpOnly`, `Secure`, `SameSite=Lax` cookie for the access token; refresh cookie `SameSite=Strict`, `Path=/api/v1/auth`. No tokens in `localStorage` or JS-readable storage.                                                                                                                                                                             |
| Password hashing   | argon2id (`@node-rs/argon2`, OWASP parameters: m = 19 MiB, t = 2, p = 1). Minimum length 12, breached-password check recommended (Phase 1 open item).                                                                                                                                                                                                    |
| Lockout            | 5 consecutive failures → lock 15 min (doubling, max 24 h); `users.failed_login_count`, `locked_until`; audited. Uniform error message for unknown email vs wrong password.                                                                                                                                                                               |
| Password reset     | Single-use token (SHA-256 stored), 30 min expiry; all sessions revoked on reset.                                                                                                                                                                                                                                                                         |
| Session marker     | `sm_s=1` (httpOnly, no secret, refresh-token lifetime, `Path=/`) tells `proxy.ts` that a refresh cookie probably exists, so an expired access token leads to `/refresh` (silent rotation) instead of `/login`.                                                                                                                                           |
| Route protection   | `proxy.ts` performs an **optimistic** check (JWT signature + expiry, no DB) and redirects to `/login`; the `(workspace)` layout re-verifies server-side; **every route handler authenticates and authorizes independently** — the proxy is never trusted for authorization (Guide §27).                                                                  |
| Session refresh    | RTK Query `baseQueryWithReauth`: on `401`, one shared (mutex) call to `/auth/refresh`, then retry; on failure, redirect to login.                                                                                                                                                                                                                        |
| Authorization      | RBAC with property-level grants ([RBAC.md](./RBAC.md)); checked in `defineRoute` and, for data-dependent rules (e.g. "own cashier shift only"), in services.                                                                                                                                                                                             |
| Property isolation | Property id from the path only → `canAccessProperty` → `ctx.propertyId` → repositories always filter by it → composite FKs make cross-property rows impossible. A resource from another property returns `404`, not `403`, to avoid disclosure. Organization-scoped data (guests, accounts) always filtered by `ctx.organizationId`.                     |
| CSRF               | `SameSite` cookies + `Origin` header check on all state-changing requests + JSON-only bodies.                                                                                                                                                                                                                                                            |
| Input validation   | Zod on every param/query/body; `.strict()` objects; server-side only authority (Guide §37).                                                                                                                                                                                                                                                              |
| SQL injection      | Prisma parameterized queries; raw SQL only through tagged `Prisma.sql` templates.                                                                                                                                                                                                                                                                        |
| Rate limiting      | Login, refresh, password reset: per IP + per account. API: per user token bucket. Production store: Redis (see open questions); development: in-memory.                                                                                                                                                                                                  |
| Secure headers     | `next.config.ts`: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP. Phase 1 adds a nonce-based CSP from `proxy.ts`. `poweredByHeader: false`.                                                                                                                                                      |
| Secrets            | `.env` (git-ignored) validated by `lib/env.ts`; server-only module guard; no `NEXT_PUBLIC_*` secrets. Production secrets from the platform secret store.                                                                                                                                                                                                 |
| Sensitive PII      | ID document numbers encrypted with AES-256-GCM (`FIELD_ENCRYPTION_KEY`), keyed hash for duplicate detection, last 4 in clear. Reading requires `guests:read_sensitive` and is audited. Privacy export/anonymization via `guests:privacy`.                                                                                                                |
| Payment security   | **No PAN/CVV/track data ever reaches our servers or database.** Card entry uses the payment provider's hosted fields/iframe (PCI DSS SAQ A scope); we store only provider tokens, brand, last 4, expiry. Refunds cannot exceed the original payment (DB check). Payment, refund and void are high-risk permissions with mandatory reason and HIGH audit. |
| Audit              | Append-only `audit_logs` written in the same transaction as the change (trigger forbids UPDATE/DELETE). High-risk actions carry reason code, before/after, IP, user agent. The application DB role should additionally lack `UPDATE`/`DELETE` grants on ledger tables in production.                                                                     |
| Dependencies       | `npm audit` in CI. Note: `prisma` CLI (dev-only) currently pulls a flagged `mysql2`; not shipped in the runtime bundle; track upstream fix.                                                                                                                                                                                                              |

## 10. Real-time operations

- Every state change that other screens care about writes an `outbox_events` row **inside its transaction** (`room.status_changed`, `reservation.checked_in`, `folio.posted`, `housekeeping.task_updated` …).
- A relay publishes pending events to Server-Sent Events streams: `GET /api/v1/properties/{id}/events` (one stream per open workspace). Clients map event types to RTK Query tag invalidations.
- Phase 7 starts with a single-instance relay (poll outbox every 1 s, or PostgreSQL `LISTEN/NOTIFY`). Multi-instance deployment needs a shared fan-out (PostgreSQL `LISTEN/NOTIFY` per instance or Redis pub/sub) — see open questions.
- Polling (RTK Query `pollingInterval`) is the fallback for screens without SSE.

## 11. Integration architecture

- Integrations never write core tables directly. They call module services (inbound) or consume outbox events (outbound).
- Each external system gets an adapter folder `modules/integrations/<system>/` implementing a narrow port defined by the consuming module, e.g. `payments` defines `PaymentProvider { createPaymentSession, capture, refund, void }`; `front-desk` defines `DoorLockProvider { issueKey }`.
- External identifiers are stored as references (e.g. `reservations.external_reference`, `payments.gateway_reference`); a generic `external_mappings` table is added when the first two-way integration (channel manager) arrives.
- Planned adapters: payment gateway (first), channel manager/booking engine, POS posting interface, accounting export (GL mapping on transaction codes), door locks, SMS/WhatsApp/email, ID scanning.
- Sales & catering is a **separate bounded context** (Guide §23): it will own leads, events, function spaces and catering orders, and interact with PMS only through `groups`/`blocks` (room blocks) and `billing` (event folio) services.

## 12. Performance architecture

**High-volume tables** (row growth drivers for a 300-room hotel, per year): `folio_items` (~1–3 M), `audit_logs` (~2–5 M), `room_status_history` (~0.5 M), `reservation_room_nights` (~0.1 M), `housekeeping_tasks` (~0.1 M), `outbox_events` (~1 M, purged), `payments`, `stays`, `reservations`. Chains multiply by property count.

| Risk                                    | Mitigation                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading large datasets into the browser | Every list endpoint is paginated (cursor default, max 200); grids request a bounded window (e.g. room rack = rooms × 14 days).                                                                                                                        |
| Expensive reports                       | SQL aggregation (`GROUP BY` in PostgreSQL); closed dates read `daily_statistics` snapshots written by night audit; heavy reports run as background jobs with export files. `EXPLAIN (ANALYZE, BUFFERS)` reviewed for every report query before merge. |
| Availability search                     | O(room types × nights) read of `room_type_inventory` counters + sparse `restrictions`; no scanning of reservations.                                                                                                                                   |
| Guest search                            | `pg_trgm` GIN index on normalized `search_name`; exact indexes for email, phone, confirmation number, room number.                                                                                                                                    |
| N+1 queries                             | Repositories return complete view shapes with Prisma `select`/`include` or one raw SQL query; lint/review rule: no query inside loops; batched `IN (…)` lookups.                                                                                      |
| Unbounded parallelism                   | No `Promise.all` over unbounded arrays of queries; bulk writes use `createMany` / `INSERT … SELECT`.                                                                                                                                                  |
| Contention                              | Short transactions; inventory rows locked in fixed order; night audit uses set-based SQL (one `INSERT … SELECT` for room charges, not per-room loops).                                                                                                |
| Table growth                            | Plan monthly partitioning of `audit_logs` and yearly partitioning of `folio_items` by `business_date` before they exceed ~50 M rows; outbox purge after publish + 7 days.                                                                             |
| Caching                                 | RTK Query short caches + tag invalidation + SSE. Server-side caching only for reference data (room types, codes, transaction codes) with explicit invalidation on settings change. No cache for money or inventory.                                   |
| Connections                             | One PrismaClient per process with `@prisma/adapter-pg` pool; a pooler (PgBouncer, transaction mode) in production.                                                                                                                                    |

## 13. Testing strategy

| Layer                 | Tool                                                                                                                                                   | Scope                                                                                                                                                                                                                                                                                                                                                                               | Where                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Unit                  | Vitest                                                                                                                                                 | policies & state machines, rate/tax/package calculation, money & date utils, permission evaluation, Zod contracts                                                                                                                                                                                                                                                                   | `tests/unit/`                      |
| Database rules        | Vitest + **PGlite** (PostgreSQL 18 in WASM, all migrations applied)                                                                                    | check/exclusion constraints, triggers, composite-FK isolation — runs anywhere, no database server needed                                                                                                                                                                                                                                                                            | `tests/db/` (implemented, passing) |
| Integration (service) | Vitest + real PostgreSQL (native install, dedicated `serene_management_test` database; CI service container), migrated schema, per-test data factories | every workflow in PMS_WORKFLOWS.md: reservation create/modify/cancel/reinstate with inventory, room assignment conflicts, check-in, check-out, postings, routing, split/transfer, payments/refunds, cashier close, housekeeping transitions, night audit success and failure-rollback, business date roll, multi-property isolation, concurrency (two agents selling the last room) | `tests/integration/`               |
| API                   | Vitest calling exported route handlers with real `Request` objects against the integration database                                                    | authentication, 401/403/404 matrix per permission, validation envelope, idempotency replay, CSRF origin check                                                                                                                                                                                                                                                                       | `tests/integration/api/`           |
| End-to-end            | Playwright                                                                                                                                             | critical paths: login → book → check-in → post → pay → check-out; night audit; housekeeping on tablet viewport                                                                                                                                                                                                                                                                      | `tests/e2e/` (from Phase 7)        |

Rules: every critical workflow ships with integration tests (Guide §53); every permission-guarded endpoint has an allowed and a denied test; every bug fix adds a regression test; CI runs `typecheck → lint → unit → db → integration → build`.

## 14. Observability and error handling

- Structured JSON logs (request id, user id, property id, route, duration, error code); `console.error` only for `INTERNAL_ERROR` with stack.
- `x-request-id` returned on every response and shown in UI error states so staff can quote it.
- Night audit writes per-step results to `night_audit_steps`.
- Health endpoint `/api/health` (DB connectivity) in Phase 1.

## 15. Decisions that refine the Guide

These are additions or clarifications, documented rather than silently applied (per the Phase 0 brief):

| #   | Guide text                                                                    | Decision                                                                                                                                                                | Why                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Route group `(dashboard)` (§33)                                               | Named `(workspace)`; property-scoped routes under `[propertyCode]`                                                                                                      | Avoids confusion with the `dashboard/` route; the property in the URL gives correct deep links, multi-tab use and cache keys.                          |
| D2  | `store/auth.store.ts`, `store/property.store.ts` (§34)                        | Not created                                                                                                                                                             | Session user is server data (RTK Query `me`); selected property is URL state.                                                                          |
| D3  | Domain folders `reservations.service/repository/schema/types/routes.ts` (§39) | Live in `modules/<domain>/`; the "routes" layer is Next's `app/api/v1/**/route.ts`; added `<domain>.policy.ts` for pure rules                                           | Keeps HTTP routing in the framework's convention and makes state machines unit-testable and shareable with the UI.                                     |
| D4  | Route-local `lib/reservations.schema.ts` (§33)                                | Holds **form** schemas composed from the module's API contract                                                                                                          | One source for API contracts; forms may add UI-only fields.                                                                                            |
| D5  | Money as decimal or minor units (§15)                                         | `NUMERIC(19,4)` + ISO currency; decimal strings on the wire; `Prisma.Decimal` arithmetic on the server                                                                  | 4 fraction digits support KWD/BHD/OMR (3 decimals) and tax precision.                                                                                  |
| D6  | "Stay → Folio" (Phase 0 brief)                                                | Folios attach to `reservation_rooms`; `stays` is 1:1 with `reservation_rooms`                                                                                           | Deposits, no-show and cancellation fees are posted before/without a stay.                                                                              |
| D7  | Night audit order (§18)                                                       | Pre-checks (read-only) → one transaction: post room & tax, packages, fixed charges, no-shows, statistics, close date, open next                                         | Guarantees "never partial closure"; postings are dated to the closing date.                                                                            |
| D8  | Room statuses list (§11)                                                      | Four stored axes (housekeeping, front office, service, guest service) + derived display status                                                                          | Avoids an explosion of combined enum values and keeps OOO/OOS independent of cleanliness.                                                              |
| D9  | Same-day adjustments                                                          | Ledger stays append-only: same-day corrections are `REVERSAL` rows (excluded from the adjustment report); prior-day ones are `ADJUSTMENT` rows with the adjustment code | Full auditability without in-place edits.                                                                                                              |
| D10 | Scripts                                                                       | npm scripts call tool entry files through `node`                                                                                                                        | npm's Windows `.cmd` shims break on paths containing `&` (this repository's path).                                                                     |
| D11 | "Docker-ready development" (§1 Other)                                         | Development uses a **native PostgreSQL installation** (Windows service); no Docker. `npm run db:setup` creates the app role and databases once                          | Supervisor requirement. The application, Prisma schema and migrations are unchanged; containerized deployment can be added later without code changes. |

## 16. Open architectural questions

Decisions needed from the product owner before or during the named phase:

1. **Payment gateway(s)** (Phase 6): which provider(s) for Pakistan/GCC (e.g. local acquirers vs Stripe/Checkout.com)? Determines tokenization UX and whether card-present terminals are needed.
2. **Fiscal/tax compliance** (Phase 6): which jurisdictions? FBR/PRA POS integration in Pakistan, ZATCA e-invoicing in KSA, UAE VAT? Affects invoice numbering, QR codes and credit-note rules.
3. **Rate limiting & real-time fan-out store** (Phase 1/7): approve Redis in production, or stay PostgreSQL-only (`LISTEN/NOTIFY`, table-based rate limits) for simpler hosting?
4. **Hosting target**: single VM/container with PostgreSQL, managed PostgreSQL + container platform, or Vercel + managed PostgreSQL? Affects SSE (long-lived connections), background jobs and scheduled night audit.
5. **Automatic night audit**: may the audit run on a schedule, or always be started by a user? (Default: user-started, with scheduled reminder.)
6. **Headless UI library**: React Aria Components (recommended: best-in-class accessibility, RTL and date pickers) vs Radix UI + separate date picker.
7. **Urdu typography**: Naskh-style (IBM Plex Sans Arabic, dense, recommended for operational screens) vs Nastaliq (traditional, much taller lines)?
8. **Housekeeping attendants without logins**: confirm that attendants may exist without user accounts (modelled) and that supervisors update on their behalf.
9. **Guest profile sharing across properties**: fully central (modelled), or should some properties in an organization be isolated from each other's guest data?
10. **Row-level security**: add PostgreSQL RLS on `property_id` as defense in depth (requires setting `app.property_id` per transaction), or rely on service scoping + composite FKs (current design)?
11. **Data retention**: how long to keep audit logs, guest documents, cancelled reservations; privacy law obligations (PDPA/GDPR for foreign guests)?
12. **Channel manager** (Phase 12): which provider? Determines whether availability/rates must be pushed in real time from Phase 4 onward.
13. **Currency**: single property currency with foreign-currency payments (modelled), or true multi-currency folios?
