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

**Implemented in Phase 8** (property-scoped, under `/api/v1/properties/{propertyId}`):

```
GET  night-audits/readiness                 # pre-audit checklist (nightaudit:read)
GET  night-audits                           # run history, keyset pages (nightaudit:read)
POST night-audits                           # run the audit: { reason } + Idempotency-Key (nightaudit:run, HIGH); 201 with the run
GET  night-audits/{runId}                   # run, steps, summary (nightaudit:read)
POST night-audits/{runId}/recover           # stale run: { reason } (nightaudit:run, HIGH)
GET  reports                                # catalog filtered by permission
GET  reports/{reportKey}?from&to&roomTypeId&risk   # JSON { columns, rows, totals, notes }
GET  reports/{reportKey}/export?…           # CSV (reports:export + the report's permission)
GET  dashboard                              # KPIs (dashboard:read; revenue with reports:financial)
POST stays/{stayId}/extend                  # { version, departure, override?, reason? } (reservations:update)
POST reservation-rooms/{id}/reinstate-no-show   # { version, reason, override } (reservations:reinstate, HIGH)
```

New error detail reasons: `BUSINESS_DATE_CHANGED` (423 for commands, 409 for a night-audit start: the date rolled while the request waited), `NIGHT_AUDIT_RUNNING` (409), `DATE_AHEAD` (422), `RUN_NOT_STALE` / `NIGHT_AUDIT_COMMITTING` (409), `NIGHTS_NOT_POSTED` (422 at check-out). A database-level posting to a closed date (SQLSTATE `SM004`) answers 423.

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

**Implemented in Phase 3 (front desk)**:

```text
GET   /api/v1/properties/{id}/front-desk/summary                 counts for the tabs and room board (business date)
GET   /api/v1/properties/{id}/front-desk/arrivals?q=&filter=&cursor=&limit=     filter: all|pending|unassigned|assigned|checked_in|vip
GET   /api/v1/properties/{id}/front-desk/in-house?q=&filter=&cursor=&limit=     filter: all|arrived_today|due_out
GET   /api/v1/properties/{id}/front-desk/departures?q=&filter=&cursor=&limit=   filter: all|due_out|departed
GET   /api/v1/properties/{id}/front-desk/rooms?filter=&roomTypeId=              room board (occupancy, readiness, today's arrival)
POST  /api/v1/properties/{id}/front-desk/walk-ins                book + check in (one transaction), 201
GET   /api/v1/properties/{id}/reservation-rooms/{rrId}/room-options           rooms usable for the remaining nights, with readiness
POST  /api/v1/properties/{id}/reservation-rooms/{rrId}/check-in              { version, roomId?, acceptNotReady?, reason? } → stay, 201
GET   /api/v1/properties/{id}/stays/{stayId}                     stay detail with room history, room status changes, audit history, allowed actions
POST  /api/v1/properties/{id}/stays/{stayId}/room-move           { version, roomId, reasonCodeId, reason?, acceptNotReady? }
POST  /api/v1/properties/{id}/stays/{stayId}/check-out           { version, earlyDeparture?, reasonCodeId?, reason? }
```

**Implemented in Phase 5 (folios, charges, payments)**:

```text
GET   /api/v1/properties/{id}/billing/options                                  charge codes, payment methods, financial reason codes, currency + minor units
GET   /api/v1/properties/{id}/folios?view=in_house|open_balance|all&q=&cursor=&limit=
GET   /api/v1/properties/{id}/reservation-rooms/{rrId}/folio                   account: windows (ledger totals), room-night posting state, actions
POST  /api/v1/properties/{id}/reservation-rooms/{rrId}/folio                   {}  open next window (1: billing:post; 2+: billing:transfer)
GET   /api/v1/properties/{id}/reservation-rooms/{rrId}/folio/history           audit trail of the windows (billing:read + audit:read)
POST  /api/v1/properties/{id}/reservation-rooms/{rrId}/room-charges            { through? }  past unposted nights · Idempotency-Key
GET   /api/v1/properties/{id}/folios/{folioId}/items?cursor=&limit=            ledger, oldest first, running balance
POST  /api/v1/properties/{id}/folios/{folioId}/charges/preview                 { transactionCodeId, quantity, unitAmount, reference?, comment? }  posts nothing
POST  /api/v1/properties/{id}/folios/{folioId}/charges                         same body · billing:post · Idempotency-Key
POST  /api/v1/properties/{id}/folios/{folioId}/payments                        { methodId, amount, version, currencyCode?, reference?, comment? } · payments:create · Idempotency-Key
POST  /api/v1/properties/{id}/folios/{folioId}/settle                          { version } · payments:create
POST  /api/v1/properties/{id}/folio-items/{itemId}/reverse                     { reason, reasonCodeId? } · billing:adjust (HIGH) · Idempotency-Key
POST  /api/v1/properties/{id}/folio-items/{itemId}/adjust                      { amount, reasonCodeId, reason } · billing:adjust (HIGH) · Idempotency-Key
POST  /api/v1/properties/{id}/payments/{paymentId}/void                        { reason, reasonCodeId? } · payments:void (HIGH) · Idempotency-Key
POST  /api/v1/properties/{id}/payments/{paymentId}/refund                      { amount, reasonCodeId, reason, reference? } · payments:refund (HIGH) · Idempotency-Key
```

Bodies are strict: totals, taxes, balances, business dates and currency conversions are never accepted from the client (`currencyCode` on a payment is only an echo, and anything but the folio currency is refused). Amounts are decimal strings with at most the currency's minor units. Error reasons: `CODE_NOT_POSTABLE`, `PAID_OUT_NOT_SUPPORTED`, `FOLIO_CLOSED`, `NIGHT_NOT_OVER`, `NOTHING_TO_POST`, `NOT_CHECKED_IN`, `MAX_WINDOWS`, `CURRENCY_MISMATCH`, `PACKAGE_EXCEEDS_RATE`, `NOT_A_CHARGE`, `NOT_REVERSIBLE`, `NOT_ADJUSTABLE`, `ADJUSTMENT_EXCEEDS_CHARGE`, `PAYMENT_EXCEEDS_BALANCE`, `CURRENCY_NOT_SUPPORTED`, `METHOD_MISCONFIGURED`, `NOT_VOIDABLE`, `REFUND_NOT_ALLOWED`, `NOT_SETTLEABLE`, `FOLIO_BALANCE_OUTSTANDING` (422); `BALANCE_CHANGED`, `STALE_VERSION`, `NIGHT_POSTING_CHANGED` (409); `IDEMPOTENCY_CONFLICT` (409).

**Implemented in Phase 4 (rooms, housekeeping, maintenance)**:

```text
GET   /api/v1/properties/{id}/rooms/board?filter=&floorId=&roomTypeId=   shared room board + counts (front desk, housekeeping)
GET   /api/v1/properties/{id}/rooms/board-options                        floors, room types, block reasons
GET   /api/v1/properties/{id}/rooms/{roomId}                             room detail, live blocks, status history
POST  /api/v1/properties/{id}/rooms/{roomId}/blocks                      { kind, from?, to, reasonCodeId, notes?, reason }  rooms:out_of_order (HIGH)
POST  /api/v1/properties/{id}/room-blocks/{blockId}/release              { reason }  return to service (room DIRTY + cleaning task)
POST  /api/v1/properties/{id}/rooms/{roomId}/inspect                     { version, outcome: PASS|FAIL, notes? }  housekeeping:inspect
POST  /api/v1/properties/{id}/rooms/{roomId}/mark-dirty | mark-clean      { version, notes? }  housekeeping:update | housekeeping:assign
GET   /api/v1/properties/{id}/housekeeping/summary | options
GET   /api/v1/properties/{id}/housekeeping/tasks?view=open|mine|inspections|all&status=&roomId=&cursor=&limit=
POST  /api/v1/properties/{id}/housekeeping/tasks                         { roomId, taskTypeId, priority, assigneeId?, notes? }  housekeeping:assign
GET   /api/v1/properties/{id}/housekeeping/tasks/{taskId}
POST  /api/v1/properties/{id}/housekeeping/tasks/{taskId}/assign | start | pause | complete | skip | cancel
GET   /api/v1/properties/{id}/maintenance?view=open|mine|in_progress|resolved|closed|all&priority=&q=&cursor=&limit=
POST  /api/v1/properties/{id}/maintenance                                { roomId|location, categoryId, title, priority, assigneeId?, blockRoom?, reason? }
GET   /api/v1/properties/{id}/maintenance/summary | options | {requestId}
POST  /api/v1/properties/{id}/maintenance/{requestId}/assign | start | hold | resume | resolve | close | reopen | cancel | block-room | notes
```

Commands carry the aggregate `version` (task, request, or the room's for room-level housekeeping commands); the server decides every target status from the action. Error reasons: `NOT_TASK_OWNER`, `NOT_ASSIGNEE` (403); `TASK_EXISTS`, `BLOCK_OVERLAPS`, `ROOM_ASSIGNED`, `ROOM_OCCUPIED`, `BLOCK_RELEASED` (409); `BLOCK_OVERSELLS`, `ROOM_STILL_BLOCKED`, `NO_ROOM` (422). Guest names on the board are returned only to users with `frontdesk:read`.

Check-in is addressed by reservation room (the stay does not exist yet); later commands by stay. Stay commands carry the stay's `version`. Permissions: `frontdesk:read` (lists, stay), `rooms:read` (room board, room options), `frontdesk:checkin` (+ `reservations:create` for walk-ins, `rooms:assign` to choose a room), `rooms:assign` (moves), `frontdesk:checkout`; accepting a room that is not ready needs `rooms:update_status`. Error reasons in `error.details.reason`: `ROOM_REQUIRED`, `ROOM_OCCUPIED` (409), `ROOM_NOT_READY`, `ROOM_OUT_OF_ORDER`, `ROOM_TYPE_MISMATCH`, `NO_REMAINING_NIGHTS`, `EARLY_DEPARTURE_NOT_CONFIRMED`, `SAME_DAY_CHECK_OUT` (422).

The reservation **room** is the unit of every command (a multi-room booking has one per room); the booking (`reservations/{id}`) is the read aggregate.

**Implemented in Phase 6 (rates, packages, restrictions, groups)**:

```text
GET    /api/v1/properties/{id}/rate-plans                                   list (derivation, seasons, packages)            rates:read
POST   /api/v1/properties/{id}/rate-plans                                   { code, name, kind, derivation?, roomTypeIds, …, reason }   rates:manage (HIGH)
GET    /api/v1/properties/{id}/rate-plans/{planId}                          detail + seasons + actions                        rates:read
PATCH  /api/v1/properties/{id}/rate-plans/{planId}                          { version, …, status?, reason }                   rates:manage (HIGH)
POST   /api/v1/properties/{id}/rate-plans/{planId}/seasons                  { version, name, startDate, endDate, daysOfWeek, priority, amounts[], reason }
PATCH  /api/v1/properties/{id}/rate-plans/{planId}/seasons/{seasonId}       new prices of a season (same body)
DELETE /api/v1/properties/{id}/rate-plans/{planId}/seasons/{seasonId}       { version, reason }
PUT    /api/v1/properties/{id}/rate-plans/{planId}/packages                 { version, packageIds, reason }
GET    /api/v1/properties/{id}/rates/options                                room types, plans, codes, business date           rates:read
GET    /api/v1/properties/{id}/rates/calendar?ratePlanId=&roomTypeId=&from=&to=   nightly prices from the pricing engine (< 62 nights)
GET    /api/v1/properties/{id}/packages                                     packages + components                             rates:read
POST   /api/v1/properties/{id}/packages                                     { code, name, postingType, sellSeparately, components[] }   packages:manage
PATCH  /api/v1/properties/{id}/packages/{packageId}                         (components with id are updated, others created/removed)
GET    /api/v1/properties/{id}/restrictions?from=&to=                       rows per night and scope                          availability:read
POST   /api/v1/properties/{id}/restrictions                                 { action set|clear, type, from, to, daysOfWeek, roomTypeId?, ratePlanId?, value?, reason }   availability:manage (HIGH)
POST   /api/v1/properties/{id}/reservation-rooms/{rrId}/packages            { packageId, quantity, startDate, endDate }       reservations:update
DELETE /api/v1/properties/{id}/reservation-rooms/{rrId}/packages/{rpId}                                                       reservations:update
GET    /api/v1/properties/{id}/reservation-rooms/{rrId}/charge-estimate     nightly room/package/tax lines (billing engine)   reservations:read
GET    /api/v1/properties/{id}/groups?status=&q=&cursor=                    groups with pickup totals                         groups:read
POST   /api/v1/properties/{id}/groups                                       { code, name, accountProfileId?, contactGuestId?, notes? }  groups:manage
GET    /api/v1/properties/{id}/groups/options                               block statuses, rate plans, room types, codes
GET    /api/v1/properties/{id}/groups/{groupId}                             group, blocks with night grid, reservations, actions
PATCH  /api/v1/properties/{id}/groups/{groupId}                             { name?, accountProfileId?, contactGuestId?, notes? }
POST   /api/v1/properties/{id}/groups/{groupId}/status                      { status CLOSED|CANCELLED, reason }
POST   /api/v1/properties/{id}/groups/{groupId}/blocks                      { code, name, statusId, startDate, endDate, ratePlanId, allocations[], isElastic?, cutoffDate?, override?, reason? }
POST   /api/v1/properties/{id}/blocks/{blockId}/allocation                  { version, roomTypeId, from, to, rooms, override?, reason? }
POST   /api/v1/properties/{id}/blocks/{blockId}/status                      { version, statusId, override?, reason? }
POST   /api/v1/properties/{id}/blocks/{blockId}/release                     { version, roomTypeId?, from?, to?, reason } · Idempotency-Key
POST   /api/v1/properties/{id}/blocks/{blockId}/pickups                     { guestId, roomTypeId, arrival, departure, adults, children?, rooms?, override?, reason? } · reservations:create + groups:read · Idempotency-Key
```

Prices, totals, pickup counts, remaining rooms and currencies are never accepted from the client; the rate plan's currency is always the property's. Overbooking (`override`) additionally requires `reservations:override_availability` and is audited HIGH. Error reasons: `INVALID_DERIVATION`, `PLAN_IS_DERIVED`, `PLAN_HAS_SEASONS`, `PLAN_HAS_ACTIVE_CHILDREN`, `SEASON_CONFLICT`, `NO_SEASON`, `OCCUPANCY_NOT_PRICED`, `RATE_NOT_SELLABLE`, `COMPONENT_POSTED`, `PACKAGE_NOT_SOLD_SEPARATELY`, `RESERVATION_NOT_ACTIVE`, `GROUP_NOT_ACTIVE`, `BLOCK_WITHOUT_RATE`, `BLOCK_NO_AVAILABILITY`, `BLOCK_NOT_DEFINITE`, `NOT_IN_BLOCK`, `BLOCK_EXHAUSTED`, `BLOCK_HAS_PICKUP`, `BLOCK_CANCELLED`, `ALLOCATION_BELOW_PICKUP`, `NOTHING_TO_RELEASE`, `BLOCK_PICKUP_LOCKED`, `NO_CANCEL_STATUS`, `INVALID_STATE_TRANSITION`, database guard `SM003` (422); `STALE_VERSION`, `IDEMPOTENCY_CONFLICT` (409). A group or block of another property answers 404; a property the user cannot access answers 403.

**Implemented in Phase 7 (guests, companies, loyalty)** — organization-level routes; the service checks the permission at any accessible property:

```text
GET    /api/v1/guests?q=&status=&cursor=&limit=                 search / list (name words, e-mail, phone digits, profile or readable confirmation number)   guests:read
POST   /api/v1/guests                                            { names, email?, phone?, …, allowDuplicate? } → 409 POSSIBLE_DUPLICATE with matches              guests:create
GET    /api/v1/guests/options                                    VIP levels, preference catalog, properties for scoping
GET    /api/v1/guests/{id}                                        profile (+ companies with accounts:read, loyalty with loyalty:read, history with audit:read)
PATCH  /api/v1/guests/{id}                                        { version, …fields, contacts?, addresses?, isRestricted?, status?, reason? }   guests:update (DOB: guests:read_sensitive)
PUT    /api/v1/guests/{id}/preferences                            { version, preferences[{ preferenceCodeId, propertyId|null, note }] }
POST   /api/v1/guests/{id}/notes                                  { body, visibility, isAlert, propertyId|null }
DELETE /api/v1/guests/{id}/notes/{noteId}
GET    /api/v1/guests/{id}/history?propertyId=&status=&from=&to=&cursor=   reservations / stays at readable properties; money only with billing:read
POST   /api/v1/guests/{id}/loyalty                                { programId, tierId?, membershipNumber? (external), reason }   loyalty:manage
GET    /api/v1/accounts?q=&type=&status=&cursor=                  companies / travel agents                                     accounts:read
POST   /api/v1/accounts                                          { type, code, name, … }                                        accounts:manage
GET    /api/v1/accounts/{id}                                      detail + contacts (guests:read) + reservations + negotiated rates
PATCH  /api/v1/accounts/{id}                                      { version, …, status?, isRestricted?, reason? }
PUT    /api/v1/accounts/{id}/contacts/{guestId}                  { kind, role, isPrimary } (one relationship per pair)
DELETE /api/v1/accounts/{id}/contacts/{guestId}
GET    /api/v1/loyalty/programs                                   programs, tiers, member counts                                 loyalty:read
POST   /api/v1/loyalty/programs                                   { code, name, isExternal, reason }                             loyalty:manage (HIGH)
PATCH  /api/v1/loyalty/programs/{id}                              { name?, status?, reason }
POST   /api/v1/loyalty/programs/{id}/tiers                        { code, name, rank, qualifyingNights?, qualifyingStays?, reason }
GET    /api/v1/loyalty/programs/{id}/members?cursor=
PATCH  /api/v1/loyalty/tiers/{id}                                 { name?, rank?, thresholds?, status?, reason }
PATCH  /api/v1/loyalty/memberships/{id}                           { version, tierId?, status?, reason }
POST   /api/v1/loyalty/memberships/{id}/adjustments               { version, points (whole, signed), description, reason }
PUT    /api/v1/properties/{id}/reservations/{reservationId}/company    { version, companyId|null, bookerGuestId|null, reason? }   reservations:update
PUT    /api/v1/properties/{id}/rate-plans/{planId}/accounts            { version, accounts[{ accountProfileId, validFrom, validTo }], reason }   rates:manage (HIGH)
```

`POST /reservations` (and walk-ins) accept `companyId` and `bookerGuestId`; `GET /availability` accepts `companyId` and then also quotes that company's negotiated plans. Error reasons: `POSSIBLE_DUPLICATE`, `CODE_TAKEN`, `ALREADY_ENROLLED`, `NUMBER_TAKEN`, `STALE_VERSION` (409); `NOT_COMPANY_CONTACT`, `COMPANY_RESTRICTED`, `RATE_REQUIRES_COMPANY`, `PLAN_NOT_NEGOTIATED`, `INVALID_MEMBERSHIP_CHANGE`, `INSUFFICIENT_POINTS`, `MEMBERSHIP_INACTIVE`, `PROGRAM_INACTIVE`, `TIER_INACTIVE`, `GUEST_INACTIVE`, `PLAN_HAS_ACTIVE_CHILDREN` (422). Profiles, companies and memberships of another organization answer 404.

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
- **As implemented (Phase 5):** required (16–80 characters of `[A-Za-z0-9_-]`, 400 otherwise) on the financial commands — charges, room charges, payments, reversals, adjustments, voids, refunds — through `definePropertyRoute({ idempotent: true })`. The hash covers method, path and the _validated_ body. The key row is claimed inside the command's transaction right after the business-date lock: a concurrent duplicate blocks until the first commits and then receives the stored result; if the first failed, its key rolled back with it and the retry runs normally. Each dialog in the UI chooses its key when it opens. Check-in, check-out and room moves keep relying on the aggregate `version` (D14).

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
