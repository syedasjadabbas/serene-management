# SERENE MANAGEMENT — Implementation Roadmap

Every phase ends only when its features meet the Guide's **Definition of Done** (§53): model + migration, service, API, authentication, RBAC, Zod, RTK Query endpoints + tags, UI with loading/empty/error/permission states, audit, related modules updated, reports considered, tablet/mobile considered, accessibility, tests (integration for workflows), seed/demo data, and `npm run verify` green (typecheck, lint, tests, production build).

---

## Dependency analysis — changes to the suggested sequence

The Phase 0 brief proposed: 1 Auth/RBAC/Org/Property → 2 Rooms → 3 Guests → 4 Rates/Availability → 5 Reservations → 6 Front desk/Room rack → 7 Check-in/In-house/Check-out → 8 Housekeeping → 9 Billing → 10 Night audit → 11 Groups → 12 Reports → 13 Advanced.

The architecture analysis changes it in four places:

1. **Billing core moves before check-in/check-out.** Check-in opens folios and transfers deposits; check-out requires zero balances, invoices and payments. Building check-out before folios would mean fake balances or rework. Billing & cashiering therefore becomes Phase 6, and Front Desk (room rack + check-in + in-house + check-out) becomes a single Phase 7 that completes the guest lifecycle end to end.
2. **Business date, audit log, outbox and transaction codes are platform foundations.** Every posting and status change needs the property business date and an audit record from day one, so they land in Phase 1 (business date: open/read; the roll comes with night audit). Transaction codes and taxes are configuration needed by rate plans (room charge code), so they are set up in Phase 2.
3. **Minimal housekeeping status is part of rooms (Phase 2)**; the full housekeeping module (tasks, sheets, inspections, discrepancies) stays after the front desk because it is driven by check-outs and stays.
4. **Groups need the inventory engine, not reports**: block allocations feed the same counters from Phase 4, so the availability engine is designed with the `blocked` counter from the start, and Groups follow Night Audit (which runs cutoff/wash).

## Phase overview

| Phase | Name                                                                | Depends on | Core outcome                                                                                         |
| ----- | ------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 0     | Architecture                                                        | —          | This foundation (done)                                                                               |
| 1     | Platform: auth, RBAC, organization & property, business date, audit | 0          | Staff can log in, switch property, and see only what they are allowed to                             |
| 2     | Property configuration & rooms                                      | 1          | Rooms, types, statuses, OOO/OOS, code tables, transaction codes & taxes                              |
| 3     | Profiles                                                            | 1          | Central guest and account profiles with search and duplicate detection                               |
| 4     | Rates & availability                                                | 2          | Rate plans, seasons, derived rates, restrictions, packages, live availability                        |
| 5     | Reservations                                                        | 3, 4       | Full reservation lifecycle before arrival + room assignment                                          |
| 6     | Billing, payments & cashiering core                                 | 5          | Folios, posting engine, taxes, routing, payments, deposits, refunds, cashier shifts, invoices        |
| 7     | Front desk & in-house                                               | 5, 6       | Room rack, arrivals/departures, check-in, in-house operations, check-out, real-time updates          |
| 8     | Housekeeping & maintenance                                          | 7          | Task generation, sheets, inspection, discrepancies, maintenance ↔ OOO                                |
| 9     | Night audit & business date roll                                    | 6, 7, 8    | Transactional end of day, statistics snapshot, audit reports                                         |
| 10    | Groups & blocks                                                     | 5, 9       | Blocks, allocations, pickup, rooming lists, master folios, cutoff/wash                               |
| 11    | Reports, dashboards & analytics                                     | 9          | Report framework, operational & financial reports, dashboards with drill-down, exports, scheduling   |
| 12    | Advanced PMS                                                        | all        | Commissions, loyalty, AR/city ledger, advanced rates, integrations, multi-property operations, stock |

## Phase 0 — Architecture ✅

Delivered:

- Next.js 16.3 / React 19.2 / TypeScript (strict + `noUncheckedIndexedAccess`) / Tailwind CSS v4 / App Router, ESLint with architectural import boundaries, Prettier, Vitest.
- Prisma 7.10 multi-file schema (123 models across 11 domain files), baseline migration + hand-written constraints migration (checks, 3 exclusion constraints, append-only/immutability triggers), verified with zero drift.
- Shared foundations: Prisma client (`@prisma/adapter-pg`), env validation, API envelope and error codes, error mapping, Zod primitives, permission catalog (78 permissions) and 13 role templates with evaluation helpers, RTK Query `baseApi` + store factory + provider, Zustand UI store, i18n config (en/ur/ar, RTL), design tokens (light/dark, status colors, density), security headers, idempotent reference-data seed, native PostgreSQL bootstrap script (`npm run db:setup`, no Docker).
- Tests: unit (permissions, validation) + database-rule tests on PGlite (isolation, business date, room assignment conflicts incl. share-with and day use, append-only audit, reservation checks) — 18 passing.
- Documentation: this set.

## Phase 1 — Platform

Scope:

- `identity`: login, logout, refresh rotation with reuse detection, lockout, password reset, session list/revoke; argon2id; cookies.
- `access`: access-profile loader, `GET /me`, `defineRoute` (authenticate, scope, authorize, validate, CSRF origin check, idempotency, rate limiting, error mapping incl. exclusion/check/SM codes), `requireSession()` for server components.
- `proxy.ts`: optimistic gating + nonce CSP.
- `properties`: organization and property CRUD (admin), property configuration, go-live (first business date).
- `business-date`: read current date, `IN_AUDIT` lock helper used by posting services.
- `audit` writer + audit log viewer (read); `events` outbox writer.
- Users & roles admin (invite, assign roles per property, disable, unlock) with no-privilege-escalation rule.
- UI: `(auth)` pages, `(workspace)` shell (navigation, property switcher, business-date indicator, user menu, command menu skeleton), first design-system primitives (Button, Input, Select/Combobox, Dialog, Drawer, Tabs, Badge, Tooltip, Toast, DataTable base, EmptyState, ErrorState, PermissionDenied, Skeleton, Kbd).
- Decide open questions 3, 4, 6, 7 (ARCHITECTURE.md §16).
- Seed: demo organization with two properties and users for every role template.

Exit criteria: integration tests for login/refresh/reuse/lockout/reset; 401/403/404 matrix; property isolation (user of property A cannot read property B); audit written for user/role changes.

### Phase 1 status (implemented, pending commit)

Delivered: login/logout, access JWT + rotating refresh token with reuse detection and a 20 s race window, account lockout, session list/revoke, `GET /me`, `definePublicRoute` / `defineSessionRoute` / `definePropertyRoute` (CSRF origin check, per-IP rate limits, authentication, property scoping from the path, authorization, high-risk reason, Zod validation, envelope, database-error mapping incl. `23P01`/`23514`/`SM001`/`SM002`), `proxy.ts` (token gating + nonce CSP), organization/property retrieval and creation, property configuration (HIGH audit, time zone frozen after go-live), business-date view/initialization and the `requireOpenBusinessDate` posting lock, audit writer + paginated reader, users & roles administration (grant/revoke with no-escalation, disable, unlock), login/refresh/no-access pages and a minimal authenticated shell (property switcher, business-date badge, user menu), demo seed (`SEED_DEMO=true`), 82 tests (unit, PGlite database rules, integration against `serene_management_test`).

Deferred, with reason:

- **Password reset and user invitation**: need outbound email (integration not chosen yet). Schema (`password_reset_tokens`, `INVITED` status) is ready; users are created by the seed meanwhile.
- **Idempotency keys**: no Phase 1 command needs replay protection; the mechanism lands with the first payment/posting command (Phase 5–6).
- **Outbox writer / SSE**: no Phase 1 event has a consumer; introduced with the room rack (Phase 7).
- **Design-system breadth**: only primitives used by Phase 1 screens were built (Button, TextField, Alert, Spinner, StatusPanel, header disclosure). React Aria Components remains the recommendation (open question 6) and is not yet adopted; current controls are native, accessible HTML.
- **Open questions 3, 4, 7** remain open: rate limiting is in process memory (single instance), hosting undecided, Urdu typeface undecided.

## Phase 2 (as executed) — Reservations + availability (tag `phase-2-complete`)

The product owner re-sequenced Phase 2 to **Reservations + Availability**. It delivers the reservation engine end to end and the minimum of the originally separate phases it depends on:

- **Availability engine**: live per-night inventory from rooms, out-of-order blocks and reservation nights; restrictions (closed, CTA/CTD, min/max LOS, stay-through, advance); rate quotes (seasons by priority and weekday, occupancy, extra adult/child, derived plans with rounding).
- **Reservation engine**: create (single/multi-room, specific room, waitlist, override), modify (dates, party, room type, rate plan, guest, codes, ETA) with optimistic concurrency, confirm, cancel (reason code, cancellation number), no-show, reinstate, room assignment; row-locked inventory with deterministic concurrency; gap-free confirmation numbers; HIGH audit for risky actions.
- **Guests**: organization-wide search (word-order independent, trigram-indexed), create, read.
- **UI**: availability, reservation search (URL filters, cursor pages), 4-step booking workflow, reservation detail with action dialogs and history; workspace navigation.
- **Data**: interim configuration builder (`prisma/seed/inventory-builder.ts`) for room types, rooms, codes, policies and rate plans, used by the demo seed and tests; demo reservations created through the service.
- **Schema**: one migration (created-date index).

Moved to later phases: configuration screens for rooms, rate plans and restrictions; full guest profiles (documents, preferences, merge); room holds and auto-assign; deposits and cancellation penalties (billing); negotiated, member and day-use rates; block pickup (groups); turnaway capture.

## Phase 7 (as executed) — Guests, companies and loyalty (pending commit)

Delivered on the existing schema (guest profiles and children, preference catalog, VIP levels, account profiles and contacts, negotiated rates, loyalty programs / tiers / memberships / transactions were modelled in Phase 0; the `guests:*`, `accounts:*` and `loyalty:*` permissions already existed; one migration `20260928090000_guests_companies_loyalty`):

- **Guest profiles**: full profile with contacts, addresses, preferred name and contact channel, VIP, restriction and status; version-checked updates; duplicate detection on creation; sensitive fields (date of birth, restricted notes) behind `guests:read_sensitive`.
- **Search**: order-free name words (trigram), e-mail (primary or listed), phone digits (trigram), profile number, and confirmation numbers of readable properties; keyset pages.
- **Preferences** from the catalog per scope, **notes** with visibility and alerts, **history** derived from reservations / stays / folios with property and financial scoping.
- **Companies**: company profiles, guest relationships with one primary contact, reservations and negotiated rates per company; company and booking contact on reservations (create, walk-in, pickup default, change command).
- **Negotiated rates**: plans that require negotiation are quoted and sold only for their linked companies, inside the link's window.
- **Loyalty foundation**: programs, tiers with qualification thresholds, one enrollment per guest and program, tier / status history, manual whole-point adjustments; recognition on reservations and stays. Automatic earning is deferred to night audit.
- **UI**: Guests workspace (guests, companies, loyalty), guest and company pages, company picker in the booking flow and on reservations, recognition strip on reservation and stay pages, negotiated companies on rate plans.

Deferred: profile merge and privacy (anonymize / export), identity documents (need field encryption), automatic points earning and tier qualification (night audit), member-only rates, preference-based room assignment, company credit / AR (accounting), preference catalog administration screen, rooming-list import.

## Phase 6 (as executed) — Rates, packages and groups (tag `phase-6-complete`)

Delivered on the existing schema (rate plans, seasons, packages, restrictions, groups, blocks and allocations were modelled in Phase 0; no permission was added; one migration `20260927090000_rates_packages_groups`):

- **Rates**: rate plan administration (base and derived plans with cycle/depth/parent/currency guards in the service and the database), seasons with priority and weekday conflicts rejected, included packages, pricing calendar computed by the booking pricing engine; group-only rates.
- **Restrictions**: administration by range, weekdays and scope; one evaluator for search, quote and booking (fixes quotes ignoring house/room-type rows).
- **Packages**: administration with components; packages on a reservation for future nights; stay charge estimate from the billing line builder (the Phase 5 carve-out and postings are reused).
- **Groups**: group profile, blocks with allocation grid (committed = DEDUCT, tentative = NON_DEDUCT, inquiry), derived blocked inventory, status transitions, manual release, idempotent pickup under lock, pickup cancellation / reinstatement through the reservation engine, group cancellation.
- **UI**: Rates workspace (plans, pricing calendar, restrictions, packages), rate plan page, Groups workspace and group page with night grid and dialogs, packages and estimate on the reservation page.

How the pieces connect: **Reservation → Rate plan** (chosen by the guest, or taken from the block for a pickup) **→ Pricing** (`quotePlan`: seasons, derivation, occupancy, restrictions; locked FOR SHARE) **→ Package** (included by the plan or added to the room; carved out of the room line) **→ Group block** (allocation grid; DEDUCT holds inventory) **→ Pickup** (reservation with `block_id`; moves a room from blocked to sold) **→ Stay** (check-in, Phase 3) **→ Folio** (nightly room + package lines posted by billing, Phase 5).

Deferred: rooming-list import, group master folio and routing, automatic cutoff/wash (night audit), yield and revenue management, OTA / channel distribution, negotiated company rates, allowance packages, per-block rate overrides, bulk rate upload.

## Phase 5 (as executed) — Folios, billing, payments and settlement (tag `phase-5-complete`)

Delivered on the existing schema (folios/windows, the append-only folio ledger, transaction codes, tax rules, payment methods, payments, refunds, idempotency keys and the `billing:*` / `payments:*` permissions were modelled in Phase 0; no permission was added):

- **Ledger**: database-maintained folio totals (trigger + guard), sign/currency/lifecycle checks, reversal and adjustment integrity in the database, deterministic posting keys.
- **Postings**: manual charges with server-side taxes (line-level, NET / COMPOUND / flat, exclusive and inclusive) and preview; room and package charges for past nights; same-day reversal; proportional adjustment.
- **Payments**: cash / card terminal / bank transfer, balance-capped, version-checked, gap-free receipts; same-day void; refunds against the original payment.
- **Settlement**: zero-balance window settle; check-out enforces `requireZeroBalanceCheckout` and settles the windows.
- **Idempotency**: `Idempotency-Key` on every financial command, claimed in the command transaction.
- **UI**: Billing workspace (accounts list), folio page (windows, totals, ledger with running balance, dialogs, audit history); stay page balance and folio link; check-out dialog balance warning.
- **Demo**: charge codes, SMR 16% sales tax, SDX service charge + municipality fee + compound VAT + tourism fee, payment methods, financial reason codes.

Deferred: night audit, deposits, routing and transfers, invoices / credit notes / CLOSED folios, cashier shifts and cash movements, payment gateway and card authorizations, foreign-currency payments, refund approval threshold, allowance packages, fixed charges, accounting exports.

## Phase 4 (as executed) — Housekeeping, rooms and maintenance (tag `phase-4-complete`)

Delivered on the existing schema (housekeeping tasks/types/attendants, maintenance requests/activities/categories, room service blocks and room status history were modelled in Phase 0; `housekeeping:*`, `maintenance:*`, `rooms:out_of_order` permissions and role templates already existed):

- **Rooms module**: readiness across occupancy, housekeeping and service; out of order (removed from inventory, oversell-checked) and out of service (sellable, not usable without override); return to service as vacant-dirty with a priority cleaning task; the single room board (filters by status, floor, room type; urgency ordering; guest names only with `frontdesk:read`); room detail with status history (now with reasons).
- **Housekeeping**: tasks with assignment to permission holders, take/start/pause/complete/skip/cancel, inspection pass/fail, supervisor corrections; check-out and room moves queue the departure clean in their transaction; workspace with board, my tasks, open tasks, inspections.
- **Maintenance**: requests with priority, assignment, start/hold/resume/resolve/close/reopen/cancel, activity log and notes, optional room block with release on resolve; workspace and request page.
- **Front desk integration**: out-of-service readiness; room assignment locks the room row (fixes a block-vs-assignment race).
- **Schema**: one migration (task completion by, status history reason, attendant roster uniqueness, lifecycle checks). **Demo**: housekeeping supervisor and maintenance users, SMR requires inspected rooms.

Deferred: task sheets and credits, night-audit task generation and carry-over, discrepancies, DND / make-up room, turndown workflow, lost and found, preventive maintenance, attachments, parts and time, scheduled blocks activated by night audit.

## Phase 3 (as executed) — Front desk: check-in, room moves, check-out (tag `phase-3-complete`)

Delivered on the existing schema (`Stay`, `RoomAssignment`, room status, `room_status_history`, reason categories, `frontdesk:*` permissions were already modelled):

- **Front desk workspace**: arrivals (due in), in house, departures (due out / departed today) and a room board for the property's business date; server-side filters, search and cursor pagination; counts per tab; 60 s refresh while focused.
- **Check-in**: from the arrivals list or the reservation detail; verify guest and stay, choose / confirm the room with its readiness; one transaction creates the stay, assigns the room if needed, marks it occupied and audits.
- **Walk-in**: the booking workflow in walk-in mode (`?walkIn=1`), booked and checked in in one transaction through the regular reservation engine.
- **Room move** (same room type, reason code, HIGH audit) with assignment history; **check-out** including confirmed early departure (unused nights released).
- **Rooms module** (`modules/rooms`): room readiness rules, locked status changes with history — the base the housekeeping phase builds on.
- **Schema**: one migration (stay occupancy guard and stay check constraints). **Tests**: unit (policies, contracts) and integration (27 scenarios incl. concurrent check-in into the only room, concurrent moves and concurrent check-outs).

Deferred: folios, settlement and deposits at check-in/out (billing), housekeeping tasks and room readiness workflow (housekeeping), upgrades, extensions, reverse check-in, same-day reinstatement, swaps, share-with, room holds, door-lock integration, `Idempotency-Key` on front desk commands (D14).

## Phase 2 — Property configuration & rooms

- Buildings, floors, room classes, room types, rooms, features, connections, component suites, conditions, housekeeping sections.
- Room status service (four axes, history, derived display status), manual housekeeping status changes, room status board (read).
- OOO/OOS (room service blocks) with reason codes, overlap protection, inventory effect (`room_type_inventory.physical/out_of_order` maintenance).
- Code tables: market groups/codes, source codes, channels, reason codes, reservation types, VIP levels, preference codes.
- Transaction code groups/codes, tax rules, payment methods (configuration only).
- Inventory horizon job: create `room_type_inventory` rows for the rolling horizon.
- Seed: floors, room types, rooms (~120 + ~60), features, codes, transaction codes, taxes.

Exit: integration tests for status transitions, OOO on occupied room rejected, inventory physical counts.

## Phase 3 — Profiles

- Guests (contacts, addresses, documents encrypted, preferences, notes/alerts, VIP, restrictions, consent), accounts (company/agent/source/OTA/wholesaler), account contacts.
- Search (trigram), duplicate detection, merge (HIGH), privacy export/anonymize.
- Recognition indicators (VIP, returning, loyalty placeholder, restricted, special occasion).
- Seed: ~2 000 guests, ~50 companies, ~20 agents.

Exit: search performance check with `EXPLAIN` on 100 k guests; merge re-points references (tests); sensitive-field permission tests.

## Phase 4 — Rates & availability

- Rate categories, rate plans (all kinds), seasons & amounts, derived rates, sell/stay windows, negotiated rates, policies (cancellation, deposit), packages & components & prices.
- Restrictions management (bulk by date range), house/room-type overbooking and sell limits.
- Availability engine + look-to-book search (single property; cross-property fan-out), rate quote with nightly breakdown, availability grid (room types × dates).
- Rate change audit (HIGH).
- Seed: BAR/corporate/package/promo rates, seasons for 18 months.

Exit: unit tests for pricing (occupancy, extra persons, derived, rounding, day-of-week, priority), restriction evaluation; integration tests for availability counters.

## Phase 5 — Reservations

- Create (single & multi-room, walk-in-ready service), modify, cancel, reinstate, copy, waitlist accept, no-show (manual), confirmation numbers, cancellation numbers.
- Nights (multi-segment, daily overrides), guests/sharers, special requests, packages, fixed charges, notes/alerts/traces, deposit requests, turnaways.
- Room assignment: manual, auto-assign batch, holds, conflict detection, upgrade/downgrade (pre-arrival).
- Reservation search (all Guide §5 criteria), reservation history (audit-based), confirmation letter (template), registration card (template).
- Concurrency test: two agents booking the last room → exactly one succeeds.
- Seed: past, current and future reservations for both properties.

## Phase 6 — Billing, payments & cashiering core

- Folios & windows, posting engine (generated taxes, tax-inclusive split, routing), manual postings, reversals, adjustments, transfers, splits, folio history, printing (PDF), invoices & credit notes (gap-free numbers).
- Payments: cash, card (provider adapter + hosted fields — open question 1), bank transfer, deposits (deposit ledger), split payments, foreign currency, receipts, refunds (with approval threshold), voids, card authorizations; webhook reconciliation.
- Cashier shifts: open, float, drops, paid-outs, close & reconciliation, cashier report.
- Decide open questions 1 and 2 before starting.

Exit: ledger invariants tested (balance equation, one reversal per item, closed folio rejects postings); idempotency replay tests; refund > payment rejected.

## Phase 7 — Front desk & in-house

- Arrivals, departures, in-house lists (derived due-in/due-out), room rack (rooms × dates, virtualized), queue, pre-registration, advance check-in.
- Check-in (standard, walk-in, mass), reverse check-in, room move/swap, upgrade in-house, extend/shorten, early/late check-out, check-out with settlement and direct bill, reinstate check-out.
- Guest messages, wake-up calls, traces dashboard, registration card, key packet info (door-lock adapter stub via outbox).
- Real-time: outbox relay + SSE → RTK Query invalidation (room status, arrivals, folio balances).
- Playwright E2E: book → check-in → post → pay → check-out.

## Phase 8 — Housekeeping & maintenance

- Task types, attendants, task generation (departure/stayover/arrival priority), task sheets (balanced by credits, by floor/section), tablet workflow (touch density), inspection, discrepancies (skip/sleep/person), turndown, DND/MUR, lost & found, housekeeping forecast, productivity.
- Maintenance requests (photos), assignment, activity history, OOO/OOS integration, preventive plans.

## Phase 9 — Night audit & business date roll

- Run orchestration (phases A/B/C), validation steps, room & tax posting (set-based), packages (rhythms, allowances), fixed charges, no-shows, releases (holds, OOO/OOS, waitlist), room status roll, next-day task generation, inventory reconciliation, statistics snapshot, date close/open, recovery of stale runs, audit report pack.
- Tests: success path; failure injected at each step → nothing posted, date OPEN; retry; concurrent posting during audit → `BUSINESS_DATE_LOCKED`; performance test with 1 000 in-house rooms.

## Phase 10 — Groups & blocks

- Groups, block statuses (configurable), blocks, allocation grid, rates, pickup, elastic/non-elastic, shoulder dates, cutoff (date and rolling days), wash, rooming list import (CSV/XLSX), group master folio & routing, group check-in/out, group reports.

## Phase 11 — Reports, dashboards & analytics

- Report framework (server-side SQL, parameters, role-based access, pagination, export CSV/XLSX/PDF, print layouts, scheduled generation as background jobs).
- Reports from Guide §25 (occupancy, ADR, RevPAR, revenue, arrivals/departures/stayovers, no-shows, cancellations, pickup, room status, housekeeping, maintenance, guest history, production by source/company/agent/rate, cashier, payment, folio, tax, deposit, commission, night audit, financial summaries).
- Operational dashboards (Guide §3.1) with drill-down, charts with Recharts, based on live queries for the open date and snapshots for history.

## Phase 12 — Advanced PMS

- Commissions (plans, calculation at check-out, approval, payment, reconciliation), loyalty (programs, tiers, points, member rates, multi-property recognition), AR / city ledger (invoices, aging, payments, statements), advanced rate management (dynamic BAR, LOS pricing, rate strategy), integrations (channel manager, booking engine, POS, accounting export, door locks, SMS/WhatsApp/email, ID scanning, BI), multi-property operations (itineraries, organization reports, central reservations), stock items (minibar postings, amenities, linen), sales & catering bounded context (separate roadmap).

## Cross-cutting tracks (every phase)

- Localization: strings externalized as features are built; Urdu/Arabic RTL review each phase.
- Accessibility: keyboard paths and screen-reader labels reviewed per screen.
- Performance: `EXPLAIN` on new list/report queries; seed volumes large enough to expose problems.
- Security: permission tests per endpoint; dependency audit in CI.
- Documentation: update the relevant doc when a domain or pattern is introduced (Guide §54).
