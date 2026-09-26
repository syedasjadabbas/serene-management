# SERENE MANAGEMENT — PMS Workflows

Functional reference: Oracle OPERA Cloud / OPERA PMS documentation (reservations, front desk, room management, cashiering, end of day, blocks). Behaviour below is SERENE's own specification.

Conventions used in every workflow:

- **D** = the property's current business date. `ctx` = authorized request context (user, property, business date).
- **Tx** = one database transaction; everything listed under "Database changes", the audit record and the outbox event commit together or not at all.
- **Audit**: `STANDARD` unless marked **HIGH** (reason code + before/after + IP/UA mandatory).
- All commands validate with Zod first, then domain rules; stale `version` → `409 CONFLICT`.
- "Inventory ±" means `room_type_inventory.sold` (or block pickup) adjusted for every affected night, rows locked in `(room_type_id, stay_date)` order.

---

## 0. Guest lifecycle map

```text
Availability search ─► Rate quote ─► Create reservation ─► (Deposit) ─► Room assignment
      │                                   │  ▲                               │
      │                   Cancel / No-show ◄┘  └─ Reinstate                   ▼
      │                                                    Pre-arrival: pre-registration, advance check-in, queue
      │                                                                      │
      └──────── Walk-in (search + book + assign + check-in in one flow) ────►│
                                                                             ▼
                                                                         Check-in ──► Stay IN_HOUSE
                                                                             │
      Charges / packages / fixed charges ◄── In-house ──► Room move / upgrade / swap
      Routing / split / transfer / adjust  │            └► Extend / shorten stay
      Payments / deposits / refunds        │
                                           ▼
                            Night audit (each night): room & tax, packages, no-shows, stats, date roll
                                           │
                                           ▼
                            Check-out ─► Invoices ─► Room VACANT/DIRTY ─► HK departure task
                                                                             │
                                                  Clean ─► Inspect ─► Room available (VC/VI)
```

---

> **Implementation status.** Phase 2 implements workflows §1, §2, §3 (pre-arrival modifications), §4 (manual room assignment; auto-assign and holds later), §14 (without penalty posting), §15 (manual no-show), §16 (reinstatement of cancellations) and the _confirm_ command (§4.1). Code: `modules/availability`, `modules/rates`, `modules/reservations`, `modules/guests`.

## 1. Availability search (look-to-book)

- **Entities**: RoomTypeInventory, HouseInventoryControl, Restriction, RatePlan, RateSeason(Amount), RatePlanRoomType, NegotiatedRate, BlockAllocation, Package.
- **Database changes**: none (read-only). Closing the search without booking may record a `Turnaway` (regret/denial).
- **Validation**: arrival ≥ D; departure ≥ arrival; adults ≥ 1; occupancy ≤ room type max; max stay length (config); rate plan sell window (booking date) and stay window; negotiated rates only with the linked account; member rates only with membership.
- **Logic**: for each room type × night compute `available`; apply restrictions (CLOSED, CTA on arrival night, CTD on departure date, min/max LOS from arrival, stay-through on any night, advance days); price each night per rate plan (season by priority and day-of-week, occupancy column, extra adult/child, derived rate formula, rounding, packages included); return per rate plan: total, nightly breakdown, policies (cancellation, deposit, guarantee), and why unavailable rate plans are closed.
- **Permissions**: `availability:read` (+ `rates:read` for prices). Cross-property search: only properties the user can access.
- **Audit**: none (turnaway row is its own record).
- **Dependent modules**: rates, availability, groups (block rates), profiles (negotiated).
- **Transaction**: read-only snapshot; availability is **re-checked under lock** at booking.
- **Failure**: none persistent.

## 2. Create reservation

- **Entities**: Reservation, ReservationRoom (1..n), ReservationRoomNight, ReservationGuest, ReservationSpecialRequest, ReservationPackage, DepositRequest, RoomTypeInventory, BlockAllocation, PropertySequence, Guest (existing or created), AccountProfile links.
- **Database changes**: insert booking + rooms + nights; confirmation number from `property_sequences('confirmation')`; inventory `sold +1` per night for deducting reservation types (or block `picked_up +1`, and `blocked −1` for deducting blocks); deposit schedule from the deposit policy (rate plan → reservation type → manual precedence); WAITLISTED rooms do not touch inventory.
- **Validation**: everything in §1 re-evaluated **after locking inventory rows**; guest profile not restricted (or override); required fields by reservation type (card token, ETA, deposit); market & source codes mandatory; party ≤ room type capacity; rate override requires reason; block must allow pickup and dates within block (or elastic/shoulder); non-guaranteed release time.
- **Permissions**: `reservations:create`; `reservations:override_rate` for manual rates/discounts (HIGH); `reservations:override_availability` to overbook/book closed (HIGH).
- **Audit**: `reservation.create` (after snapshot); overrides HIGH with reason.
- **Dependent modules**: availability, rates, profiles (history), groups (pickup), billing (deposit requests), commissions (later), housekeeping forecast (reads).
- **Transaction**: one Tx: lock business date (share) → lock inventory rows → validate → insert → counters → sequence → audit → outbox `reservation.created`.
- **Failure/rollback**: any failure (inventory exhausted between search and book, constraint, sequence) rolls back everything; no confirmation number is consumed (sequence row is inside the Tx). Client receives `409 CONFLICT` with fresh availability hint.

## 3. Modify reservation

Changes: dates (extend/shorten before arrival), room type, party, rate plan, daily rates, packages, guests, codes, notes, guarantee.

- **Entities**: ReservationRoom, ReservationRoomNight, RoomTypeInventory, BlockAllocation, RoomAssignment, DepositRequest, ReservationPackage.
- **Database changes**: diff old vs new nights → inventory −1 on removed nights, +1 on added nights (same lock order); rebuild nights (rate re-quoted unless `is_fixed_rate`); release room assignment if the room no longer fits (type change, dates conflict); recompute deposit schedule; `version + 1`.
- **Validation**: status must be WAITLISTED/RESERVED (dates) or IN_HOUSE (only departure, party, rate from today, packages); arrival of IN_HOUSE is immutable; availability/restrictions for added nights; assigned-room conflicts (exclusion constraint); rate re-quote vs keep-rate choice explicit.
- **Permissions**: `reservations:update`; rate overrides `reservations:override_rate` (HIGH).
- **Audit**: `reservation.update` with field-level before/after; rate changes HIGH.
- **Dependent modules**: availability, room assignment, billing (future nights only; posted nights untouched), housekeeping forecast.
- **Transaction**: one Tx.
- **Failure**: rollback leaves original reservation intact; `409` on stale version or conflicting assignment.

## 4. Room assignment (manual, automatic) and room hold

- **Entities**: RoomAssignment, ReservationRoom, Room, RoomHold, RoomFeature, GuestPreference, RoomConnection.
- **Database changes**: release existing ACTIVE assignment (status RELEASED, released_at) → insert new ACTIVE assignment `[arrival, departure)` with `occupancy_key` → update `reservation_rooms.room_id`; consuming a hold sets it CONSUMED.
- **Validation**: room active, type compatible (same type, or different type = upgrade/downgrade flow §9), not OOO for any night, OOS → warning/confirm, room condition hiding it → not offered, holds by other users need `rooms:override_hold`, `do_not_move` blocks re-assignment unless overridden, occupancy ≤ room max, connecting/accessible requirements satisfied. Final guarantee: exclusion constraint `room_assignments_no_overlap`.
- **Auto-assign** (batch for a date's arrivals): candidates ranked by preferences/features match, floor/smoking/accessibility, "back-to-back" optimisation (prefer rooms whose previous departure = this arrival, then rooms vacant longest), VIP first, clean/inspected first; skips multi-room and DNM reservations; each assignment is its own small Tx so one conflict does not abort the batch.
- **Room hold**: insert `room_holds` (ACTIVE, `[from,to)`, expires_at = now + hold minutes); exclusion constraint prevents double holds; expiry job marks EXPIRED.
- **Permissions**: `rooms:assign`; `rooms:hold`; `rooms:override_hold`.
- **Audit**: `room.assign` / `room.unassign` / `room.hold`.
- **Dependent modules**: front desk (room rack), housekeeping (priority for arrivals), reservations.
- **Transaction**: one Tx per assignment.
- **Failure**: conflict → `409 CONFLICT` with the conflicting reservation (if the user may see it); nothing changes.

## 5. Pre-arrival: pre-registration, advance check-in, queue

- **Pre-registration**: guest details, ID documents, registration signature, payment instrument captured before arrival → `is_pre_registered = true`; documents encrypted. Permission `frontdesk:checkin`. Audit STANDARD.
- **Advance check-in**: for due-in reservations with a valid payment method, staff registers the guest before the room is ready → `advance_check_in_at`; guest can receive services; the stay is created when the room is ready (auto check-in by event or at night audit step). Room must be assigned or will be assigned when ready.
- **Queue**: due-in reservation waiting for a room → `queued_at`, `queue_priority`; housekeeping board prioritises queued rooms (task priority); when the room becomes CLEAN/INSPECTED an outbox event notifies the front desk (and optionally SMS to the guest).
- **Tx**: one Tx per action. **Failure**: rollback, no partial flags.

## 6. Check-in (standard)

> **Implementation status (Phase 3).** Implemented: check-in with room assignment in the same transaction, readiness checks and the audited not-ready override; walk-in (§6.1) as one transaction reusing the booking engine; room move (§8, same room type); check-out with early departure (§12, §12.1) as an operational departure. Audit actions are `stay.check_in`, `stay.room_move` (HIGH), `stay.check_out` (HIGH for early departures), `reservation.create` with `walkIn: true`. **Deferred:** folios, deposit transfer, card authorization, zero-balance and invoice steps (billing), housekeeping tasks and discrepancy handling (housekeeping), door-lock integration (outbox), mass check-in (groups), reverse check-in / same-day reinstatement, swaps, upgrades (§9), extensions (§10), late check-out fees (§12.2) and express check-out (§12.3). Guest profile completeness rules (ID documents) arrive with full profiles.

- **Entities**: ReservationRoom, Stay, Room, RoomAssignment, Folio, FolioItem (deposit transfer), Payment, CardAuthorization, GuestDocument, ReservationGuest, RoutingInstruction (defaults from profiles), HousekeepingTask.
- **Database changes**: reservation room RESERVED → IN_HOUSE; insert Stay (IN_HOUSE, checked_in_at, arrival_business_date = D); room `front_office_status = OCCUPIED`; create folio window 1 (+ windows required by routing, e.g. window 2 for company); apply profile default routing; transfer deposits: for each captured DEPOSIT payment create `DEPOSIT_TRANSFER` credit on the folio; record card pre-authorization (gateway call before Tx); cancel pending HK tasks for the room that no longer apply; room status history; release room hold.
- **Validation**:
  - status RESERVED and `arrival_date = D` (early arrival → modify arrival first, §12)
  - room assigned; room VACANT; not OOO; OOS → confirm; housekeeping status CLEAN or INSPECTED (INSPECTED only if `requireInspectedForCheckIn`); no other in-house stay in the room unless share-with
  - guarantee satisfied (card token/authorization or deposit paid, per reservation type) or override
  - guest profile complete per property rules (name, nationality, ID document for foreign nationals where legally required)
  - business date OPEN (not IN_AUDIT)
- **Permissions**: `frontdesk:checkin`.
- **Audit**: `reservation.check_in` (room, guest, deposit transferred).
- **Dependent modules**: rooms, billing, payments, housekeeping, profiles (recognition), integrations (door-lock key via outbox `stay.checked_in`).
- **Transaction**: one Tx (lock business date share → reservation room → room → folios). The card authorization is performed first with an idempotent reference; if the Tx fails, the authorization is released by a compensating call (and recorded).
- **Failure/rollback**: stay not created, room stays VACANT, folio not opened. Key encoding happens after commit (outbox), so a door-lock failure never un-checks-in a guest; it is retried and surfaced.

### 6.1 Walk-in

Single guided flow = §1 search (arrival D) + §2 create reservation (`is_walk_in = true`, market/source walk-in codes, guarantee typically cash/card deposit) + §4 assign + §6 check-in. Implemented as **one service command in one Tx** so a failure never leaves a booked-but-not-checked-in walk-in. Permission: `frontdesk:checkin` + `reservations:create`.

### 6.2 Mass check-in (groups)

Iterates §6 per reservation room, each in its own Tx; returns per-room results (success / reason) — a failure of one room never rolls back the others.

### 6.3 Reverse check-in

Same business date, no postings other than deposit transfer reversed automatically → delete stay, status RESERVED, room VACANT (keep/unassign room per user choice), close empty folios. Permission `frontdesk:reverse_checkin` (HIGH).

## 7. In-house stay: charges and services

> **Implementation status (Phase 5).** Implemented: manual postings with server-calculated taxes and a preview, room and package charges for past nights (the manual stand-in for night audit's room-and-tax run, deterministic posting keys), `Idempotency-Key` replay protection, balance recomputed from the ledger under the folio lock. Deferred: routing (steps 1 and §19), paid-outs and cash movements (cashiering), POS/interface postings, fixed charges, allowance packages.

- **Entities**: Folio, FolioItem, TransactionCode, TaxRule, RoutingInstruction, CashierShift, CashMovement (paid-outs), PackageComponent.
- **Posting pipeline (billing.postCharge)**:
  1. Resolve target folio: routing instructions of the reservation room for the code/date (window, other reservation room, group master, account folio), respecting limits (overage stays on window 1).
  2. Validate: code active & manual posting allowed; amount within min/max; quantity ≠ 0; folio OPEN/SETTLED (not CLOSED); business date OPEN; cashier shift open for paid-outs.
  3. Insert charge line (`business_date = D`, `revenue_date` if different) and generated tax/service lines (net or compound, rounded to currency minor units; tax-inclusive codes split gross into net + tax).
  4. Update folio totals; folio SETTLED → OPEN.
  5. Paid-out: insert `cash_movements` (PAID_OUT, negative) on the user's open shift.
- **Permissions**: `billing:post`.
- **Audit**: `folio.post` (STANDARD); postings from interfaces carry source POS/INTERFACE.
- **Dependent modules**: reports, night audit (balance checks), cashiering, commissions (revenue basis).
- **Transaction**: one Tx; folios locked in id order when routing splits a posting across folios.
- **Failure**: rollback → nothing posted; idempotency key prevents duplicate postings on client retry.
- **Guest services** (messages, wake-up calls, traces, DND/MUR status): simple commands with `frontdesk:messages` / `housekeeping:update`, audited STANDARD.

## 8. Room move (and swap)

- **Entities**: RoomAssignment, Stay, ReservationRoom, Room (old, new), RoomStatusHistory, HousekeepingTask, ReasonCode.
- **Database changes**: current assignment `to_date` := D (released for the remainder) and new assignment `[D, departure)` (kind MOVE); `stay.room_id`, `reservation_rooms.room_id` updated; old room: VACANT (if no other sharer) + DIRTY + HK task (departure-type clean); new room: OCCUPIED; room status history for both; routing unaffected; future-dated moves create a second assignment segment scheduled from the move date.
- **Validation**: new room passes §4 checks and is VACANT & ready (CLEAN/INSPECTED) for today; reason code required; `do_not_move` override; room type change → upgrade/downgrade rules (§9).
- **Swap** (two arrivals or two in-house guests exchange rooms): both assignments released and recreated in one Tx; the exclusion constraint is checked at commit using deferred ordering (release both first, then insert both).
- **Permissions**: `rooms:assign` (+ `rooms:upgrade` if types differ).
- **Audit**: `room.move` **HIGH** (room changes are high-risk per Guide §29) with from/to room and reason.
- **Dependent modules**: housekeeping, front desk rack, integrations (door lock re-key via outbox), billing (unchanged unless rate changes).
- **Transaction**: one Tx; lock both rooms in id order.
- **Failure**: rollback keeps the guest in the original room.

## 9. Upgrade / downgrade

- **Upgrade (complimentary)**: assign a higher room type while keeping `rate_room_type_id` (charged type) unchanged → rate unchanged; inventory: booked type `sold −1` / new type `sold +1` for remaining nights (inventory follows the physical room type) — performed only if the new type has availability.
- **Upgrade (paid) / downgrade**: change `room_type_id` and `rate_room_type_id`, re-quote remaining nights (or override with reason); inventory moves as above.
- **Validation**: availability of the target type for all remaining nights; rate override rules; reason code.
- **Permissions**: `rooms:upgrade` (HIGH for complimentary), `reservations:override_rate` for manual rate.
- **Audit**: `reservation.upgrade` / `reservation.downgrade` HIGH.
- **Transaction**: one Tx together with the room assignment (§4/§8).
- **Failure**: rollback; original type, rate and room retained.

## 10. Extend / shorten stay (in-house)

- **Extension**: new departure > current; lock inventory for added nights; availability & restrictions; nights added with re-quoted or same rate; assignment `to_date` extended (exclusion constraint guards the next guest's booking of that room — conflict offers a room move); deposit/guarantee re-evaluated. Permission `reservations:update`.
- **Shorten (in-house, before departure day)**: remove future nights (only unposted nights), inventory −1, assignment `to_date` shortened. Leaving today = early departure (§12.1).
- **Audit**: `reservation.update` (dates) STANDARD; rate override HIGH.
- **Transaction**: one Tx. **Failure**: rollback.

## 11. Payment (including deposits and split payments)

> **Implementation status (Phase 5).** Implemented: cash, card (hotel terminal, approval reference required) and bank transfer recorded as CAPTURED in one transaction; amount ≤ window balance (over-payment refused); the window `version` the cashier saw is required (409 `BALANCE_CHANGED` when it moved); folio-currency only (`CURRENCY_NOT_SUPPORTED` otherwise — no FX); gap-free receipt numbers; split payments as separate commands; audit `folio.payment` HIGH. Deferred: gateway flow (PENDING/AUTHORIZED, webhooks), deposits (kind DEPOSIT, deposit ledger, transfer at check-in), foreign currency, cashier shifts and cash movements.

- **Entities**: Payment, PaymentMethod, PaymentInstrument, FolioItem (PAYMENT), Folio, DepositRequest, CashierShift, CashMovement, PropertySequence (receipt).
- **Flow for gateway (card/online) payments**:
  1. Service creates a `Payment` PENDING in its own short Tx (idempotency key → stable gateway reference).
  2. Gateway call outside any DB transaction (hosted fields/token; no card data touches the server).
  3. Second Tx: PENDING → CAPTURED (or AUTHORIZED / FAILED); on CAPTURED post `PAYMENT` folio item (negative amount), update folio totals, receipt number, cash movement if cash, deposit request allocation.
  4. Gateway webhooks reconcile PENDING payments left by crashes (idempotent by gateway reference, unique index).
- **Cash / transfer / cheque**: single Tx, captured immediately; cash requires the user's open cashier shift.
- **Deposit**: `kind = DEPOSIT`, linked to the reservation (no folio yet), allocated to deposit requests; transferred at check-in (§6).
- **Split payment**: several payments against one folio, each its own command; multiple methods allowed; the folio is SETTLED when balance = 0.
- **Foreign currency**: amount in foreign currency with the property exchange rate for D stored on the folio item (`original_amount`, `original_currency`, `exchange_rate`).
- **Validation**: amount > 0; ≤ outstanding balance unless over-payment allowed (config); method active; reference required for methods that demand it; business date OPEN.
- **Permissions**: `payments:create`; `cashier:operate` for cash.
- **Audit**: `payment.create` **HIGH** (payment changes are high-risk).
- **Failure**: gateway failure → Payment FAILED (kept for audit), folio unchanged; DB failure after capture → payment stays PENDING with gateway reference and is reconciled (never double-charged thanks to the idempotent reference).

## 12. Check-out

> **Implementation status (Phase 5).** Operational check-out (Phase 3) now includes the financial rule in the same transaction: after the room locks, every window of the stay is locked, its balance recomputed from the ledger and, when `PropertyConfiguration.requireZeroBalanceCheckout` is on (default), any non-zero window refuses the check-out (`422 FOLIO_BALANCE_OUTSTANDING`, with the windows and balances). Zero windows become SETTLED; the check-out audit records the folio summary. With the rule off, the guest may leave with a balance and the windows stay OPEN. There is no override permission: the rule is the property's configuration. Invoices, direct-bill transfer and CLOSED folios are deferred.

- **Entities**: ReservationRoom, Stay, Folio(s), FolioItem, Payment, Invoice, Room, HousekeepingTask, GuestStayStatistic, Commission, RoomAssignment, CardAuthorization.
- **Database changes**: for every folio window: must be balance 0 (settled by payments or transferred to an account folio for direct bill) → issue invoice (gap-free number, snapshot) → folio CLOSED; stay CHECKED_OUT (checked_out_at, departure_business_date = D); reservation room CHECKED_OUT; assignment `to_date` := D if earlier; room: VACANT (if no remaining sharer), housekeeping DIRTY; create HK **departure** task for D (priority by next arrival); release unused card authorizations (after commit via outbox); update `guest_stay_statistics`; calculate commission (PENDING) if an agent/source is commissionable.
- **Validation**: status IN_HOUSE; `departure_date = D` (earlier → early departure §12.1); zero balance on all windows when `requireZeroBalanceCheckout`; direct-bill transfer only to accounts with AR number and within credit limit; no unsent messages warning; business date OPEN.
- **Permissions**: `frontdesk:checkout` (+ `billing:invoice`).
- **Audit**: `reservation.check_out` STANDARD; direct-bill transfer HIGH.
- **Dependent modules**: billing, payments, housekeeping, profiles (history), commissions, loyalty (points on checkout, modular), reports, integrations (door lock cancel key).
- **Transaction**: one Tx (locks: business date share → reservation room → folios by id → room → sequences).
- **Failure**: rollback → guest remains IN_HOUSE, folios OPEN, no invoice number consumed.

### 12.1 Early check-out

Departure moved to D (future nights removed, inventory −1 for them, optional early-departure penalty posted per policy with reason), then standard check-out. Permission `frontdesk:checkout`; penalty waiver `billing:adjust` (HIGH).

### 12.2 Late check-out

Departure date unchanged (= D), later departure time: optional late-checkout fee posted (transaction code configured), HK departure task priority lowered/rescheduled, room remains OCCUPIED until check-out. If the late check-out crosses into the next day it becomes an extension (§10).

### 12.3 Express / scheduled check-out

Scheduled check-out executes §12 automatically at a time when the folio is settled (card on file); failures leave the guest in-house and alert the front desk.

## 13. Housekeeping after departure → room available

> **Implementation status (Phase 4).** Implemented: departure clean queued by check-out / room move / return to service; task assign, start (take), pause, complete, skip, cancel; room inspection pass/fail; supervisor corrections (mark dirty / mark clean, audited, with reason in the room history); housekeeping board shared with the front desk. Deferred: task sheets and credit balancing, night-audit generation of stayover tasks, discrepancies (§28), guest service status (DND / make-up room), turndown workflow, lost and found.

- **Entities**: HousekeepingTask, HousekeepingTaskSheet, Room, RoomStatusHistory.
- **Flow**: departure task PENDING → attendant IN_PROGRESS → COMPLETED (room DIRTY → CLEAN) → if inspection required: supervisor INSPECTED (room → INSPECTED) or FAILED_INSPECTION (room → DIRTY, task back to attendant). Room becomes **available for check-in** when VACANT + (CLEAN or INSPECTED per config) + IN_SERVICE. Queued arrivals are notified via outbox.
- **Validation**: attendant owns the task (or supervisor), task belongs to D, room not OOO.
- **Permissions**: `housekeeping:update`; `housekeeping:inspect`.
- **Audit**: room status changes recorded in `room_status_history` (always) + audit STANDARD.
- **Transaction**: one Tx per task transition (task + room status + history + outbox).
- **Failure**: rollback; the task and room keep their previous status.

### 4.1 Confirm (tentative / waitlisted → confirmed) — Phase 2

- **Entities**: ReservationRoom, ReservationType, RoomTypeInventory.
- **Database changes**: `reservation_type_id` → a deducting type, status `RESERVED` (from `WAITLISTED`), inventory locked and re-counted, counters rewritten.
- **Validation**: current state tentative or waitlisted; arrival ≥ D; target type deducts inventory; availability for every night (override needs `reservations:override_availability` + reason).
- **Permissions**: `reservations:update` (+ `reservations:waitlist` from the waitlist). **Audit**: `reservation.confirm` (HIGH when overridden). **Tx**: one transaction; failure leaves the reservation unchanged.

## 14. Cancellation

- **Entities**: ReservationRoom, RoomTypeInventory, BlockAllocation, RoomAssignment, RoomHold, Folio/FolioItem (penalty), Payment (deposits), DepositRequest, ReservationTrace, PropertySequence.
- **Database changes**: status → CANCELLED with `cancellation_number`, `cancelled_at/by`, reason; inventory −1 on all nights (or block pickup −1, returning the room to the block before cutoff); ACTIVE assignment RELEASED; holds released; deposit requests CANCELLED; penalty per cancellation policy (inside the deadline: none; otherwise nights/percent/flat) posted to a folio of the reservation room (created if needed) and settled from deposits where possible; remaining deposit refunded (§25) or kept per policy; open traces optionally resolved.
- **Validation**: status RESERVED or WAITLISTED; reason required; deposit present and `allowCancelWithDeposit = false` → must refund/forfeit first; group reservation after cutoff → room returns to house.
- **Permissions**: `reservations:cancel` (HIGH).
- **Audit**: `reservation.cancel` **HIGH** (reason, penalty, deposit handling).
- **Dependent modules**: availability, groups, billing, payments, profiles (statistics.cancellations), reports.
- **Transaction**: one Tx; refund to card happens after commit via the refund workflow (idempotent).
- **Failure**: rollback — reservation stays active.

## 15. No-show

- **Trigger**: night audit step (automatic, if `autoNoShowOnNightAudit`) for `RESERVED` with `arrival_date = D` not checked in; or manual for arrivals ≤ D.
- **Database changes**: status NO_SHOW, `no_show_at`; inventory −1 for all nights (the no-show night is released too); assignment released; no-show charge posted when the reservation type is guaranteed and `postNoShowCharges` (first night + tax, or policy), settled from deposit/card when possible; statistics (no-shows).
- **Validation**: non-guaranteed reservations are simply released; guaranteed ones charged per policy.
- **Permissions**: `reservations:no_show` (manual) / `nightaudit:run` (automatic).
- **Audit**: `reservation.no_show` HIGH (charges).
- **Transaction**: manual = one Tx; automatic = inside the night audit commit Tx.
- **Failure**: rollback with the enclosing Tx.

## 16. Reinstatement

| Case                   | Guard                           | Changes                                                                                                                                                                                                            | Permission                          |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Cancelled → RESERVED   | arrival ≥ D                     | inventory +1 (lock, availability re-check; override to overbook), cancellation fields cleared (history in audit), penalty reversed by `REVERSAL` if unpaid                                                         | `reservations:reinstate` HIGH       |
| No-show → RESERVED     | departure > D                   | arrival := D, nights before D removed, inventory +1 remaining nights, no-show charge reversal optional                                                                                                             | `reservations:reinstate` HIGH       |
| Checked-out → IN_HOUSE | checked out on D, audit not run | stay IN_HOUSE (`reinstated_count` +1), reservation IN_HOUSE, folios reopened (invoices credited by credit note if already issued), room OCCUPIED (if taken meanwhile → share or move), HK departure task cancelled | `frontdesk:reinstate_checkout` HIGH |

One Tx each; audit HIGH; failure → rollback.

## 17. Early check-in

Arrival date earlier than booked: modify arrival to D (§3, inventory for the added night, rate for the extra night) then check in. Same day, before standard check-in time: optional early check-in fee (configured code) with room readiness check; permission `frontdesk:checkin` (+ `reservations:update`).

## 18. Group booking, room block, rooming list, pickup, cutoff

- **Entities**: Group, Block, BlockStatus, BlockAllocation, RoomTypeInventory, Reservation, ReservationRoom, Folio (group master, pseudo room type), RoutingInstruction.
- **Block creation / change**: allocation grid room type × night; status type drives inventory: DEDUCT → `blocked += allocated − picked_up` (availability check or override); NON_DEDUCT/INQUIRY → no effect. Rate per night/type. Permission `groups:manage`; audit STANDARD (HIGH when overbooking).
- **Pickup** (reservation in block): `picked_up +1` and `blocked −1` for deducting blocks (availability unchanged); beyond allocation only if elastic → then `sold +1` from house inventory.
- **Rooming list import**: validated file → one reservation per row in batches (each its own Tx), report per row; permission `groups:rooming_list`.
- **Group master folio**: `Folio` owner GROUP_MASTER with routing instructions from members (e.g. room & tax to master, incidentals to guest).
- **Cutoff / wash** (night audit step or manual): release un-picked-up allocation for nights reaching cutoff (`released += n`, `blocked −= n`) — irreversible; wash reduces allocation by % or count.
- **Group cancellation**: allowed only with zero pickup (cancel member reservations first) → releases blocked inventory.
- **Transaction**: one Tx per block change; allocation rows locked in `(room_type_id, stay_date)` order together with inventory rows.
- **Failure**: rollback; allocation unchanged.
- **Status (Phase 6)**: implemented — group profile, blocks with allocation grid, status changes, manual release, idempotent pickup (lock block → re-count → validate → create reservation → sync pickup → audit), cancellation and reinstatement through the reservation engine, group cancellation. Deferred: rooming-list import, group master folio and routing, automatic cutoff/wash (night audit), per-block rate overrides.

## 19. Folio routing

- **Setup**: `RoutingInstruction` from a reservation room: target window (same reservation), another reservation room ("pays for"), or a specific folio (group master, account); codes list or all codes; date range; weekdays; optional limit. Profile default routing (company pays room & tax) is copied at booking/check-in.
- **Effect**: applied during posting (§7) and optionally to already-posted items (creates TRANSFER_OUT/IN pairs, §21).
- **Validation**: target folio in the same property and OPEN; target window ≤ maxFolioWindows; no routing cycles; direct bill target requires AR account.
- **Permissions**: `billing:routing`. **Audit**: STANDARD.
- **Tx**: one Tx. **Failure**: rollback.

## 20. Split folio / split charge

- **Split folio** = additional windows (1..n) with different payees (e.g. window 1 guest, window 2 company) + routing (§19).
- **Split charge**: one posted item split by amount, percent or quantity into two lines: insert `TRANSFER_OUT` of the original amount on the source and `TRANSFER_IN` lines for the parts (same transfer id), taxes re-split proportionally; neither part may be zero; payments, package lines and deposit transfers cannot be split.
- **Permission**: `billing:transfer`. **Audit**: STANDARD. **Tx**: one Tx; both folios locked. **Failure**: rollback.

## 21. Charge transfer

Move selected items between windows, to another reservation room's folio, or to a group/account folio: for each item insert `TRANSFER_OUT` (negation) on the source and `TRANSFER_IN` (copy with `origin_reservation_room_id`) on the target, sharing `transfer_id`; generated taxes move with their parent. Validation: both folios OPEN/SETTLED, same property, same currency, not CLOSED; items not already transferred. Permission `billing:transfer`; audit STANDARD (HIGH when to an AR/account folio). One Tx; rollback on failure.

## 22. Posting correction and adjustment

> **Implementation status (Phase 5).** As written: same-day `REVERSAL` of a charge with its taxes (reason required; reversing a room night re-opens it for posting), `ADJUSTMENT` of part or all of a charge on any date with the code's adjustment code (or the original code when none is configured), the credit amount including tax, split proportionally. Both require `billing:adjust` (HIGH audit `folio.reverse` / `folio.adjust`) and an `Idempotency-Key`.

- **Same business date (void/correct)**: `REVERSAL` row = exact negation of the item and its generated taxes (`corrects_item_id`, one reversal per item by unique index), then a new correct posting. Reason required. Not shown on the adjustment report.
- **Prior business date (adjustment)**: `ADJUSTMENT` row with the code's adjustment transaction code, amount or percent (≤ 100 %), reason code and comment; taxes adjusted proportionally.
- **Not adjustable**: payment lines (use refund/void), deposit transfers, lines on CLOSED folios (use credit note).
- **Permission**: `billing:adjust` (HIGH). **Audit**: `folio.adjust` HIGH with before/after amounts.
- **Tx**: one Tx. **Failure**: rollback.

## 23. Refund

> **Implementation status (Phase 5).** Without a gateway a refund completes in one transaction (Refund SUCCEEDED, `refunded_amount` raised, positive ledger line); reason code (category REFUND) and reason required; amount ≤ what remains refundable. Same-day mistakes are voided instead (`payments:void`). Deferred: approval threshold with a second user, gateway refunds, cash-out movements.

- **Entities**: Refund, Payment, FolioItem, CashierShift, CashMovement, ReasonCode.
- **Flow**: validate (payment CAPTURED; refund ≤ `amount − refunded_amount`; reason; approval above threshold by a second user with `payments:refund`) → Refund PENDING (Tx) → gateway refund (outside Tx, idempotent reference) → Tx: SUCCEEDED → `payments.refunded_amount +=`, folio item (positive, `refund_id`) if the payment was on a folio, cash movement (CASH_OUT) for cash; FAILED → recorded with reason.
- **Permission**: `payments:refund` (HIGH). **Audit**: `payment.refund` **HIGH**.
- **Failure**: gateway error → Refund FAILED, no ledger change; DB error after gateway success → reconciliation job completes it by gateway reference.

## 24. Cashier shift

Open: one OPEN shift per user & property (unique index), opening float (CASH_MOVEMENT OPENING_FLOAT). During: cash payments/refunds/paid-outs/drops recorded as signed movements. Close: expected cash = float + Σ movements; counted cash entered; variance stored; drops recorded with bag number; closed shifts immutable (movements append-only). Night audit checks no shift is OPEN for D (or auto-closes per config). Permissions `cashier:operate` (own), `cashier:manage` (others, HIGH). Audit HIGH on close with variance. One Tx per action.

## 25. Deposit handling

> **Implementation status.** Deferred beyond Phase 5: deposits need the reservation-level deposit ledger, allocation to deposit requests and the transfer at check-in; none of them is modelled as a stay field.

Deposit request schedule (§2) → deposit payment (§11, kind DEPOSIT) → allocation to request (status PAID/PARTIALLY_PAID) → at check-in `DEPOSIT_TRANSFER` credit to window 1 → on cancellation: forfeited (posted as cancellation revenue against penalty) or refunded (§23) per policy. Deposit ledger report = DEPOSIT payments not yet transferred. Night audit flags overdue deposit requests (optional auto-cancel per policy).

## 26. Night audit

Run by a user with `nightaudit:run` (HIGH) for business date D. Recorded in `night_audit_runs` / `night_audit_steps`.

**Phase A — lock the date** (short Tx): no RUNNING run (unique index) → create run RUNNING (attempt n) → business date D → IN_AUDIT. From now on postings fail with `BUSINESS_DATE_LOCKED`.

**Phase B — validations** (read-only, results stored per step):

| Step                       | Check                                                                              | Blocking?       |
| -------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| VALIDATE_DEPARTURES        | every IN_HOUSE with departure = D is checked out or extended                       | yes             |
| VALIDATE_ARRIVALS          | due-ins not checked in are listed; will become no-show (config) or must be handled | configurable    |
| VALIDATE_CASHIERS          | no OPEN cashier shift for D (or auto-close)                                        | yes / auto      |
| VALIDATE_ROOM_STATUS       | occupied rooms have an in-house stay; discrepancies listed                         | warning         |
| VALIDATE_BALANCES          | folio totals equal ledger sums; routing targets valid; credit limits               | yes on mismatch |
| VALIDATE_OPEN_TRANSACTIONS | no PENDING payments older than threshold; no unposted interface batches            | warning         |

If a blocking step fails → run FAILED, date back to OPEN (Tx), user sees what to fix. Nothing was posted.

**Phase C — close the day** (**one Tx**, set-based SQL, locks business date FOR UPDATE):

1. POST_ROOM_AND_TAX: for every IN_HOUSE stay, the `reservation_room_nights` row for D (not yet posted) → room charge (rate plan room code, `revenue_date = D`) + generated taxes, routed per instructions; package components by rhythm (included-in-rate carve-out, separate lines, allowances to package ledger); fixed charges due on D; `posted_at` set.
2. PROCESS_NO_SHOWS (§15) per configuration.
3. RELEASE: expired holds, OOO/OOS blocks reaching `to_date` (room returns to service with return status, inventory `out_of_order` restored), block cutoff/wash, waitlist purge, overdue deposit handling (policy).
4. ROOM_STATUS_ROLL: occupied (stayover) rooms → DIRTY; generate D+1 housekeeping tasks (stayover, departure-expected, arrivals priority); cancel leftover D tasks.
5. STATISTICS: write `daily_statistics` and `daily_room_type_statistics` for D (SQL aggregation); reconcile `room_type_inventory` counters against source rows (repair + log discrepancy).
6. CLOSE_DATE: D → CLOSED (`is_current = false`, closed_at/by); insert D+1 OPEN.
7. RECORD: run COMPLETED with summary; audit `nightaudit.run` HIGH and `business_date.close` HIGH; outbox `business_date.rolled`.

After commit (outside the Tx): generate audit reports (final report pack for D) as background jobs; re-authorize cards (optional); send exports.

- **Failure/rollback**: any error in Phase C rolls back **everything** (no charge posted, no no-show processed, date not closed); a separate Tx marks the run FAILED and sets D back to OPEN. Re-running is safe (new attempt). A crash between Phase A and C leaves the date IN_AUDIT with a RUNNING run; a recovery command (`nightaudit:run`) marks the stale run FAILED and reopens D. **Partial business-date closure is impossible by construction.**
- **Dependent modules**: every module; reports read the snapshot.

**As built (Phase 8)** (`modules/night-audit`, ARCHITECTURE D30 to D34):

- Checks: VALIDATE_DEPARTURES (blocking), VALIDATE_ARRIVALS (warning with automatic no-shows, blocking without them or without a no-show reason), VALIDATE_BALANCES and VALIDATE_PAYMENTS (blocking on any mismatch between folios, payments, refunds and their ledger lines), VALIDATE_ROOM_STATUS (warning), VALIDATE_POSTING (warning: earlier nights of in-house stays are posted by the audit, departed stays with unposted nights are listed), VALIDATE_CASHIERS (skipped until cashiering exists). The same checks serve the read-only readiness checklist.
- The date may be closed on or after its own calendar day in the hotel's time zone, never before.
- Phase C steps: POST_ROOM_AND_TAX (every night up to D through the billing engine, source NIGHT_AUDIT, posting keys), PROCESS_NO_SHOWS (reservations still RESERVED with arrival on or before D; the no-show fee is the arrival night's rate with the fee code's taxes for guaranteed, deducting reservation types when the property posts no-show charges and has a fee code), RELEASE (service blocks ending by D+1 released, scheduled ones starting by D+1 activated; definite blocks past their cutoff date release unpicked rooms from D+1), ROOM_STATUS_ROLL (occupied rooms to DIRTY; open tasks of D and earlier cancelled; a cleaning task for every vacant dirty room and a stayover task for every stay continuing past D+1 on D+1), RECONCILE_INVENTORY (counters from D on recounted and repaired, repairs listed), STATISTICS (room counts for night D taken before the block roll, money from the ledger, the roll-forward), CLOSE_DATE.
- Synchronous request (D31): the POST returns the run (COMPLETED, or FAILED with the failing step and reason). Step results of a failed commit are recorded as rolled back. Recovery requires the run to be older than two minutes and takes the date with NOWAIT.
- Deferred: fixed charges, allowance packages, holds, waitlist purge, overdue deposits, discrepancies, preventive maintenance, loyalty earning, guest stay statistics, outbox event and background report pack (the run page links to the date's reports instead).

## 27. Business date rollover

Only via §26 step 6. Effects visible to all modules: new postings dated D+1; arrivals/departures lists recompute (derived states); dashboards and reports switch; clients receive `business_date.rolled` via SSE and invalidate `BusinessDate` and list caches. Closed dates are immutable (trigger); corrections to closed dates are prior-day adjustments dated today. Go-live creates the first OPEN date (`properties:manage`, HIGH).

## 28. Housekeeping discrepancy

- **Detection**: when housekeeping reports occupancy/person count (`hk_reported_occupancy`, `hk_reported_persons`) that differs from front office: SKIP (FO occupied, HK vacant — guest may have left), SLEEP (FO vacant, HK occupied — unregistered occupant or missed check-in), PERSON (count mismatch) → insert `housekeeping_discrepancies` OPEN (partial unique per room/date/type) + outbox alert to front desk.
- **Resolution**: front desk investigates → checks guest out / checks in / corrects count → discrepancy RESOLVED with resolution text. Night audit lists open discrepancies (warning).
- **Permissions**: report `housekeeping:update`; resolve `frontdesk:read` + the resolving action's permission.
- **Audit**: STANDARD. **Tx**: one Tx per report/resolve.

## 29. Maintenance

> **Implementation status (Phase 4).** Implemented as written, except preventive maintenance plans, photos/attachments, time and parts tracking and on-hold from ASSIGNED. Out-of-order placement additionally checks that the room type still has a free room for every blocked night (`BLOCK_OVERSELLS`); room assignment locks the room row before its out-of-order check, so a block and an assignment of the same room cannot both succeed.

- **Report**: request (room or location, category, priority, description, photos as attachments) → OPEN; permission `maintenance:create`.
- **OOO/OOS link**: creating (or later adding) a room service block from the request (`rooms:out_of_order`, HIGH): validation that the room has no in-house guest or future assignment overlapping (must move/unassign first, listed to the user); inventory `out_of_order +1` for OOO nights (locked rows); room `service_status` updated when the block becomes ACTIVE on its from date.
- **Work**: ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED (activities recorded); resolving prompts block release → room returns with return status (usually DIRTY → housekeeping clean).
- **Preventive maintenance**: plans generate requests when `next_due_date ≤ D` (night audit step) and advance the due date.
- **Audit**: STANDARD; OOO/OOS HIGH. **Tx**: one Tx per transition (request + block + inventory + room status). **Failure**: rollback.

## 30. Multi-property operations

- **Access**: users hold organization-wide or per-property role grants; the property switcher lists only accessible properties; each request is authorized for the property in its path.
- **Central profiles**: guests/accounts are organization-scoped; history shows stays at every property the user may access (other properties' financial details hidden without permission).
- **Cross-property availability search**: fan-out over accessible properties with a bounded concurrency (one query per property, max N in parallel), each with its own restrictions and currency.
- **Cross-property reservation**: a reservation belongs to exactly one property; "multi-property itinerary" = several reservations linked by a shared booking reference (future `itineraries` table, Phase 12) — never one transaction across properties' inventories unless all succeed (one Tx is possible because it is one database; each property's rows are locked in property id order).
- **Reporting**: organization-level reports aggregate `daily_statistics` across accessible properties with currency conversion to the organization base currency.
- **Isolation guarantee**: composite FKs + `ctx.propertyId` filters + 404 for other properties' records.

**Status (Phase 9, as implemented)**:

- **Organization workspace** (`/organization`): Overview (per-property business date, night-audit state, today's figures), Reports (organization performance), Availability (central search), Audit trail, Users & roles, Properties. Offered to users with organization grants or several properties; everything shown is limited to accessible properties.
- **Switching**: the workspace switcher lists the organization workspace and the accessible properties; switching keeps the section (`/SMR/reports` → `/SDX/reports`) when the user may use it at the target, otherwise opens the target's overview; record ids are never carried over. The booking draft belongs to one property and is cleared when the property changes.
- **Central availability**: search + hand-off only. Each property answers with its own business date, restrictions, inventory, rates and currency; _Book_ continues in that property's booking workflow. No cross-property reservation, itinerary, split stay, transfer or cross-property group.
- **Reporting**: per property in its own currency, subtotals per currency, room counts and movements across properties; no currency conversion and no organization base-currency total (the bullet above describes a future option).
- **Confirmation numbers**: `PREFIX-number` per property (default prefix = property code), unique across the organization; earlier plain numbers keep working in every search.
- **New property**: create it (code, name, zone, currency, optional prefix), copy reference setup from an existing property before go-live, then set up rooms, room types and rates, then initialize the business date.

## 31. Profile merge and duplicate detection

**Status (Phase 7)**: duplicate _detection_ at creation is implemented (same e-mail or phone digits → `409 POSSIBLE_DUPLICATE` with the matches; the clerk uses the existing profile or confirms a new one). Merge itself is deferred.

Duplicate candidates by exact email/phone/document hash and trigram name similarity + birth date. Merge: survivor keeps its values, fills empty fields from the merged profile; all references (reservations, reservation guests, stays, folios payee, preferences, notes, memberships, statistics summed) re-pointed in one Tx; merged profile status MERGED with `merged_into_id`. Permission `guests:merge` (HIGH), audit HIGH with both snapshots. Irreversible except by audit-assisted manual correction.
