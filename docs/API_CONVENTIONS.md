# SERENE MANAGEMENT — API Conventions

Applies to every route handler under `app/api/v1/`. Implemented foundations: `types/api.ts` (envelope, error codes), `lib/http/errors.ts`, `lib/http/response.ts`, `lib/validation/common.ts`. Route pipeline: `lib/http/route.ts` with three variants: `definePublicRoute` (login, refresh, logout, health), `defineSessionRoute` (authenticated; optional organization-level permission), `definePropertyRoute` (authenticated; property id from the path, property-level permission). "defineRoute" below refers to these.

---

## 1. Principles

1. Route handlers are thin: **authenticate → authorize → validate → call service → respond** (Guide §39). No business logic, no Prisma calls in handlers (lint-enforced).
2. The server is the authority: every request is authorized independently of the UI and of `proxy.ts`.
3. The property scope comes **only from the URL path**, never from the body or a header.
4. JSON in, JSON out. Money as decimal strings, dates as `YYYY-MM-DD`, instants as ISO-8601 UTC.
5. Contracts are Zod schemas in `modules/<domain>/<domain>.schema.ts`, shared with the UI (forms and RTK Query types).

## 2. Endpoint naming

- Base: `/api/v1`. Breaking changes → `/api/v2` for the affected resources; additive changes stay in v1.
- Resources are plural nouns, kebab-case: `reservation-rooms`, `transaction-codes`.
- Path parameters are UUIDs (`{reservationId}`), except human lookups exposed as query filters (`?confirmationNumber=`).

**Organization-scoped** (central data, user's organization implied by the session):

```text
GET    /api/v1/me                                   # user, accessible properties, permissions per property
GET    /api/v1/guests?q=&cursor=&limit=
POST   /api/v1/guests
GET    /api/v1/guests/{guestId}
PATCH  /api/v1/guests/{guestId}
POST   /api/v1/guests/{guestId}/merge
GET    /api/v1/accounts?type=COMPANY
GET    /api/v1/users · POST /api/v1/users · PATCH /api/v1/users/{userId}
GET    /api/v1/roles · PUT /api/v1/roles/{roleId}/permissions
```

**Property-scoped**:

```text
/api/v1/properties/{propertyId}/…
  GET  business-date
  GET  availability?arrival=2026-10-01&departure=2026-10-04&adults=2&roomTypeId=&ratePlanId=
  GET  reservations?status=RESERVED,IN_HOUSE&arrivalFrom=&arrivalTo=&q=&sort=-arrivalDate&cursor=&limit=
  POST reservations
  GET  reservations/{reservationId}
  PATCH reservations/{reservationId}
  GET  rooms?floorId=&status=VACANT_DIRTY
  GET  room-rack?from=2026-10-01&days=14
  GET  folios/{folioId}
  GET  folios/{folioId}/items?cursor=
```

**Commands** (state transitions) are `POST` sub-resources named with a verb, because they are not CRUD and carry their own validation, permission and audit:

```text
POST reservation-rooms/{id}/cancel          { reasonCodeId, comment?, version }
POST reservation-rooms/{id}/reinstate
POST reservation-rooms/{id}/assign-room     { roomId, version }
POST reservation-rooms/{id}/check-in        { version, … }
POST reservation-rooms/{id}/check-out       { version }
POST reservation-rooms/{id}/move-room       { roomId, reasonCodeId, version }
POST folios/{id}/postings                   { transactionCodeId, quantity, unitAmount, … }
POST folio-items/{id}/reverse               { reasonCodeId, comment }
POST folio-items/transfer                   { itemIds[], targetFolioId }
POST payments                               { folioId | reservationId, methodId, amount, … }
POST payments/{id}/refunds                  { amount, reasonCodeId, comment }
POST rooms/{id}/status                      { housekeepingStatus, version }
POST night-audits                           # starts a run
GET  night-audits/{runId}                   # progress / result
```

HTTP method semantics: `GET` safe and cacheable by RTK Query; `POST` create or command; `PATCH` partial update of editable fields (never status); `PUT` full replacement of a sub-collection (e.g. role permissions); `DELETE` only for truly removable things (notes, holds) — financial and operational records are never deleted.

**Implemented in Phase 2**:

```text
GET   /api/v1/guests?q=&limit=                                  guest search (organization-wide, bounded)
POST  /api/v1/guests                                            create guest profile
GET   /api/v1/guests/{guestId}
GET   /api/v1/properties/{id}/availability?arrival=&departure=&adults=&children=&rooms=&roomTypeId=&ratePlanId=
GET   /api/v1/properties/{id}/booking-options                   room types, rate plans, reservation types, codes, reasons
GET   /api/v1/properties/{id}/rooms/available?roomTypeId=&arrival=&departure=
GET   /api/v1/properties/{id}/reservations?q=&state=&arrivalFrom=&...&sort=&cursor=&limit=
POST  /api/v1/properties/{id}/reservations                      create (1..20 rooms, optional room, waitlist, override)
GET   /api/v1/properties/{id}/reservations/{reservationId}      detail with nights, notes, history, allowed actions
PATCH /api/v1/properties/{id}/reservation-rooms/{rrId}          modify (version required)
POST  /api/v1/properties/{id}/reservation-rooms/{rrId}/confirm | cancel | no-show | reinstate | assign-room
```

The reservation **room** is the unit of every command (a multi-room booking has one per room); the booking (`reservations/{id}`) is the read aggregate.

## 3. Request validation

- Every handler declares Zod schemas for `params`, `query` and `body`. Objects are `.strict()` (unknown fields → `VALIDATION_FAILED`).
- Query strings are coerced (`z.coerce.number()`), lists are comma-separated (`status=RESERVED,IN_HOUSE`).
- Shared primitives (`lib/validation/common.ts`): `idSchema`, `isoDateSchema`, `isoDateTimeSchema`, `localTimeSchema`, `currencyCodeSchema`, `moneyAmountSchema`, `cursorPageQuerySchema`, `offsetPageQuerySchema`, `sortQuerySchema`, `reasonSchema`, `versionSchema`.
- Validation is only the first gate: services enforce domain rules (availability, state transitions, balances) and the database enforces invariants.

## 4. Response structure

Success:

```json
{ "data": { "id": "0199…", "confirmationNumber": "100245", "status": "RESERVED" } }
```

Lists:

```json
{
  "data": [{ "id": "…" }],
  "meta": { "nextCursor": "eyJpZCI6…", "limit": 50 }
}
```

- `201 Created` for creations (body contains the created resource); `200` otherwise; `202 Accepted` for background jobs (night audit reports, exports) with a job resource to poll.
- Response DTOs are explicit (`<domain>.types.ts`); never return Prisma rows directly (no leaking internal columns, hashes or ciphertexts).
- Money: `{ "amount": "1250.0000", "currency": "PKR" }` or `amount` + a sibling `currencyCode` on the resource.
- Every response carries `x-request-id`.

## 5. Error structure

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Reservation cannot move from CHECKED_OUT to CANCELLED",
    "details": { "entity": "Reservation", "from": "CHECKED_OUT", "to": "CANCELLED" },
    "requestId": "0199a0f2-…"
  }
}
```

| Code                       | HTTP | When                                                                              |
| -------------------------- | ---- | --------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`        | 400  | Schema validation; `details.fields = { path: [messages] }`                        |
| `UNAUTHENTICATED`          | 401  | Missing/expired/invalid access token (client refreshes once, then logs in)        |
| `FORBIDDEN`                | 403  | Missing permission; `details.permission` names it                                 |
| `NOT_FOUND`                | 404  | Absent **or belongs to a property/organization the caller cannot access**         |
| `CONFLICT`                 | 409  | Unique violation, stale `version`, overlapping room assignment, concurrent change |
| `IDEMPOTENCY_CONFLICT`     | 409  | Same `Idempotency-Key` reused with a different payload                            |
| `BUSINESS_RULE_VIOLATION`  | 422  | Valid input rejected by a rule (no availability, balance not zero, closed folio)  |
| `INVALID_STATE_TRANSITION` | 422  | State machine forbids the transition                                              |
| `BUSINESS_DATE_LOCKED`     | 423  | Night audit in progress / date closed                                             |
| `RATE_LIMITED`             | 429  | With `Retry-After`                                                                |
| `INTERNAL_ERROR`           | 500  | Unexpected; logged with stack; message generic                                    |
| `PAYMENT_PROVIDER_ERROR`   | 502  | Gateway declined/unavailable; `details.providerCode`                              |

Rules: messages are safe to show; the client localizes by `code` (+ `details`), falling back to `message`. Errors are never swallowed (Guide §47). Database errors are mapped centrally in `lib/http/response.ts`. Implemented now: unique → `CONFLICT`, FK → `BUSINESS_RULE_VIOLATION`, record missing → `NOT_FOUND`, serialization/deadlock after retries → `CONFLICT`. Phase 1 adds, once verified against the driver adapter's error shape: exclusion constraint (`23P01`) → `CONFLICT`, check violation (`23514`) and `SM001`/`SM002` → `BUSINESS_RULE_VIOLATION`.

## 6. Pagination

- **Cursor** (default for operational lists: reservations, guests, folio items, audit log): `?cursor=<opaque>&limit=50` (max 200). The cursor encodes the sort key + id (UUIDv7 gives a stable tiebreaker). Response `meta.nextCursor` (null at end).
- **Offset** (reports, admin tables that show page numbers): `?page=1&pageSize=50` (max 200) → `meta { page, pageSize, total }`. `total` is computed with a separate `COUNT(*)` only where needed.
- Grids with natural bounds (room rack, availability grid) take a bounded window (`from` + `days ≤ 31`) instead of pagination.
- No endpoint returns an unbounded list.

## 7. Filtering, sorting, search

- Filters are explicit query parameters per endpoint (typed in the endpoint's query schema): `status`, `arrivalFrom`, `arrivalTo`, `departureFrom`, `roomTypeId`, `companyId`, `blockId`, `sourceCodeId` … Unknown parameters are rejected.
- Date-range filters are inclusive `from`/`to` of `YYYY-MM-DD`.
- `sort=field,-field` from an allow-list per endpoint (`sortQuerySchema`); default sort documented per endpoint; every sort includes `id` as tiebreaker.
- `q=` free-text search per resource: guests (trigram on normalized name, exact on email/phone/document hash), reservations (confirmation number exact, guest name, room number, external reference), accounts (name trigram, IATA, AR number).
- Global search `GET /api/v1/properties/{id}/search?q=` fans out to the indexed searches (bounded, top N per type) for the command menu.

## 8. Property scoping

- `propertyId` in the path is authorized by `definePropertyRoute` (`canAccessProperty`) before the body is parsed. An inaccessible, foreign or non-existent property id all return the same `403 FORBIDDEN` ("You do not have access to this property"), so ids cannot be probed.
- A property id supplied in a body (e.g. a role grant for a property) is authorized by the service in exactly that scope.
- Services receive `ctx.propertyId`; repositories **must** include it in every `where` for property-scoped tables (and composite FKs make cross-property writes fail).
- Loading a resource checks `resource.property_id = ctx.propertyId`; mismatch → `404`.
- Organization-scoped endpoints filter by `ctx.organizationId`.

## 9. Authentication

- Cookies: `sm_at` (access JWT, 15 min, `httpOnly; Secure; SameSite=Lax; Path=/`), `sm_rt` (refresh, 14 days, `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`).
- Endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`.
- `401 UNAUTHENTICATED` → client performs one refresh (mutex-shared across concurrent requests) and retries; refresh failure → redirect to `/login?next=`.

## 10. Authorization

- Each route declares exactly one required permission (`resource:action`); commands with data-dependent rules add service checks (e.g. closing another user's cashier shift needs `cashier:manage`).
- High-risk permissions (`isHighRisk` in the catalog) require `reasonCodeId` (and `comment` when the reason code demands it) in the body; missing → `VALIDATION_FAILED`.
- Denials return `403` with `details.permission` and are logged (not audited as business events, but counted for security monitoring).

## 11. Idempotency

- Required header `Idempotency-Key` (UUID) on: payments, refunds, postings, transfers, check-in, check-out, night audit start, reservation create.
- Stored per `(user, key)` with a SHA-256 of the request; replay with the same body returns the stored status/body; a different body → `409 IDEMPOTENCY_CONFLICT`; keys expire after 24 h.
- RTK Query mutations generate the key once per user intent (not per retry).

## 12. Concurrency

- Mutable resources expose `version`. Updates/commands send the `version` the user saw; mismatch → `409 CONFLICT` with `details.reason = "STALE_VERSION"`; the UI reloads and shows what changed.
- The service layer handles row locking; clients never hold locks.

## 13. Audit logging

- Services write audit records inside the business transaction via `audit.record(tx, ctx, { action, resourceType, resourceId, before, after, risk, reasonCodeId, reason })`.
- Actions are `resource.verb` (`reservation.cancel`, `folio.adjust`, `room.status_change`, `user.role_grant`).
- `requestId`, IP and user agent come from `ctx`. HIGH risk for the Guide §29 list (payments, refunds, rates, cancellations, room changes, folio adjustments, permission changes, night audit, business date, configuration).
- Read access to sensitive data (ID documents) is audited as `guest.document_view`.

## 14. Transactions

- One command = one service method = one `prisma.$transaction` (see ARCHITECTURE.md §5 for lock order and retries).
- External calls (payment gateway, door locks, email) never run inside a database transaction; they use the two-step pattern (pending record → external call → completion) or the outbox.
- Long-running operations (night audit, exports, rooming list import) return `202` with a job/run resource.

## 15. Real-time events

`GET /api/v1/properties/{propertyId}/events` (Server-Sent Events): `event: room.status_changed` / `data: { roomId, … }`. Events are hints to refetch (tag invalidation), never the source of truth; payloads contain ids and changed fields, no sensitive data.

## 16. Example handler (target shape, Phase 1)

```ts
// app/api/v1/properties/[propertyId]/folios/[folioId]/postings/route.ts
import { defineRoute } from "@/lib/http/route";
import { postChargeSchema, folioParamsSchema } from "@/modules/billing/billing.schema";
import { billingService } from "@/modules/billing/billing.service";

export const POST = defineRoute({
  permission: "billing:post",
  params: folioParamsSchema,
  body: postChargeSchema,
  idempotent: true,
  status: 201,
  handler: ({ ctx, params, body }) => billingService.postCharge(ctx, params.folioId, body),
});
```
