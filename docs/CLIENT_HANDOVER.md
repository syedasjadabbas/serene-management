# SERENE MANAGEMENT — Client handover

This guide is for the hotel's owners, administrators and managers. It covers what the system does, who can do what, how daily operations run, the business rules it enforces, and what depends on services outside the application.

Technical documents for the IT team or hosting provider:

| Topic                                          | Document                       |
| ---------------------------------------------- | ------------------------------ |
| Installation, environment, first administrator | `docs/DEPLOYMENT.md`           |
| Backups, maintenance, monitoring, runbooks     | `docs/OPERATIONS.md`           |
| Security model                                 | `docs/SECURITY.md`             |
| Roles and permissions (full catalog)           | `docs/RBAC.md`                 |
| Workflow rules in detail                       | `docs/PMS_WORKFLOWS.md`        |
| Open technical findings                        | `docs/PRODUCTION_READINESS.md` |
| Offline design                                 | `docs/OFFLINE_ARCHITECTURE.md` |
| API reference for integrators                  | `docs/API_CONVENTIONS.md`      |

---

## 1. The product

SERENE MANAGEMENT is a web-based property management system (PMS) for one hotel company with one or more properties. Staff use it in a browser on desktop PCs, tablets or phones. Every property has its own:

- rooms;
- rates;
- business date;
- folios;
- reports.

The organization level shows all properties together.

All money is stored as exact decimals in the property's currency. Every change that matters is recorded in an audit trail that cannot be edited.

### 1.1 Modules

| Area           | Where in the application  | What it covers                                                                                                                                                                |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard      | Property → Dashboard      | Today's arrivals, in-house guests, departures, room status, attention items                                                                                                   |
| Front desk     | Property → Front desk     | Arrivals, check-in, walk-ins, in-house list, room moves, stay extensions, check-out, reverse check-in, room board                                                             |
| Reservations   | Property → Reservations   | Search, new reservation wizard (availability, rate, guest, company), modify, cancel, no-show, reinstate, room assignment, packages, history                                   |
| Availability   | Property → Availability   | Availability and rates by room type and date, restrictions, overbooking with permission                                                                                       |
| Guests         | Property → Guests         | Guest profiles, preferences, notes, stay history; Companies (corporate and travel-agent accounts, contacts, negotiated rates); Loyalty (programs, tiers, memberships, points) |
| Groups         | Property → Groups         | Group profiles, room blocks and allocation, pick-up, release, cut-off, close and cancel                                                                                       |
| Housekeeping   | Property → Housekeeping   | Room status board, task sheets, assignment, cleaning, inspection                                                                                                              |
| Maintenance    | Property → Maintenance    | Maintenance requests, assignment, resolution, out-of-order and out-of-service rooms                                                                                           |
| Property setup | Property → Property setup | Room types, floors, rooms, taxes, operating settings, go-live                                                                                                                 |
| Rates          | Property → Rates          | Rate plans, seasons, restrictions, company rates; Packages                                                                                                                    |
| Billing        | Property → Billing        | Folios and windows, charges, payments, reversals, adjustments, voids, refunds, settlement                                                                                     |
| Night audit    | Property → Night audit    | Readiness checks, running the audit, rollover of the business date, run history and recovery                                                                                  |
| Reports        | Property → Reports        | 23 reports with CSV export (section 5.10)                                                                                                                                     |
| Organization   | Organization              | Overview of all properties, cross-property availability and reports, audit trail, users and roles, properties                                                                 |
| Search         | Search box in the top bar | Guests, reservations, rooms, companies and groups of the property; guest and company profiles across the organization                                                         |
| Live updates   | Automatic                 | Lists and boards refresh when a colleague changes something                                                                                                                   |
| Offline        | Automatic                 | Read-only copy of the front-office view when the connection drops (section 6)                                                                                                 |

---

## 2. Roles and permissions

Access is granted per person as one or more **roles**. A role applies either to the whole organization or to one property. A person sees only the properties where they hold a role. Inside a property, they see only the pages and buttons their roles allow.

The server checks every request again, so hiding a button is never the only protection. This was verified for every role by calling the API directly.

| Role                 | Typical person                   | Can do                                                                                                                                    |
| -------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Organization Admin   | Owner or IT of the hotel company | Everything, in every property, including users, roles and properties                                                                      |
| General Manager      | Runs a property                  | Everything at the property except creating properties and editing roles                                                                   |
| Front Office Manager | Front office supervisor          | Front desk and reservations, including overrides, reinstatements, reverse check-in, adjustments, refunds, voids, night audit, audit trail |
| Front Desk Agent     | Reception                        | Reservations, check-in and check-out, room assignment and status, charges and payments                                                    |
| Reservations Agent   | Sales and bookings               | Create, modify and cancel reservations; guest and company profiles; deposits                                                              |
| Housekeeping Manager | Head of housekeeping             | Task sheets and assignment, inspection, room status, out-of-order rooms, housekeeping reports                                             |
| Housekeeper          | Room attendant                   | Their own tasks and room cleaning status; report maintenance issues                                                                       |
| Maintenance Manager  | Head of engineering              | Assign and close requests, out-of-order and out-of-service rooms                                                                          |
| Maintenance Staff    | Technician                       | Read and update requests, report new ones                                                                                                 |
| Cashier              | Cashiering desk                  | Charges and payments                                                                                                                      |
| Accountant           | Back-office finance              | All financial data, adjustments, refunds, financial reports and exports                                                                   |
| Auditor              | Internal or external audit       | Read-only access, financial reports and the audit trail                                                                                   |

How it works in practice:

- **High-risk actions need a reason**, which is recorded in the audit trail. This covers:
  - cancellations and reinstatements;
  - overbooking;
  - refunds and voids;
  - adjustments;
  - reverse check-in;
  - setup changes;
  - user and role changes;
  - night audit.
- **No one can grant more than they hold.** A General Manager can invite and assign front-office roles at their own property, but cannot create an Organization Admin.
- **Roles are fixed templates.** Their contents cannot be edited in the application (section 10).
- Some permissions in the catalog are reserved for features that are not built yet. Granting or withholding them changes nothing today; `docs/RBAC.md` §2 lists them.

---

## 3. Before the first day: what the client configures

There is no hard-coded hotel data. Everything specific to the client is entered by the client's administrator. The order below is the one the application expects.

| Step | What                                 | Where                                             | Notes                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Organization and first administrator | Server command `npm run ops:bootstrap` (IT, once) | `docs/DEPLOYMENT.md` §5. The password is typed at a hidden prompt, never on the command line                                                                                                                                                                                                                      |
| 2    | Properties                           | Organization → Properties → New property          | Code, name, time zone, currency, confirmation prefix. The first property receives the starter setup (step 3)                                                                                                                                                                                                      |
| 3    | Starter setup (automatic)            | —                                                 | Charge codes (restaurant, room service, minibar, breakfast, laundry, telephone, transfer, spa, miscellaneous), payment methods (cash, card, bank transfer), reason, market and source codes, reservation types, cancellation policies, block statuses, housekeeping task types, maintenance categories. No prices |
| 4    | Further properties                   | Property → Property setup → Overview → copy from  | Copies another property's setup before go-live                                                                                                                                                                                                                                                                    |
| 5    | Room types                           | Property setup → Room types                       | Code, name, occupancy limits                                                                                                                                                                                                                                                                                      |
| 6    | Floors and rooms                     | Property setup → Rooms                            | Add rooms in ranges such as `101-120, 201-220`, with type, floor, smoking and accessibility flags and their current housekeeping status                                                                                                                                                                           |
| 7    | Taxes (optional)                     | Property setup → Taxes                            | Percentage or fixed amount per unit, the revenue codes it applies to, and effective dates. A rate change is a new end date plus a new tax, so past postings keep their tax                                                                                                                                        |
| 8    | Operating settings                   | Property setup → Settings                         | Check-in and check-out times, folio windows per stay, inspected-room rule, pick-up status, automatic no-shows and no-show charges, zero-balance check-out, time zone and confirmation prefix (until go-live)                                                                                                      |
| 9    | Rate plans, seasons, restrictions    | Property → Rates                                  | At least one rate plan is required to go live                                                                                                                                                                                                                                                                     |
| 10   | Packages (optional)                  | Property → Rates → Packages                       | Inclusions sold with a rate or a reservation                                                                                                                                                                                                                                                                      |
| 11   | Companies and loyalty (optional)     | Property → Guests → Companies / Loyalty           | Corporate accounts with negotiated rates; loyalty programs and tiers                                                                                                                                                                                                                                              |
| 12   | Go-live (opening business date)      | Property setup → Overview → Go live               | Needs `properties:manage`. Choose today or yesterday in the property's time zone. After go-live the time zone and confirmation prefix are fixed                                                                                                                                                                   |
| 13   | Users                                | Organization → Users & roles → Add user           | Section 4                                                                                                                                                                                                                                                                                                         |

The Property setup overview shows a checklist (room types, rooms, taxes and rate plans) and enables **Go live** only when the required items are in place.

Before go-live, reservations cannot be made. The property dashboard links to Property setup.

---

## 4. Users and sign-in

**Adding a user.** Go to Organization → Users & roles → **Add user**. Enter the e-mail, the name, the first role and a reason. The application creates the user as _Invited_ and shows a **one-time set-up link, valid for 24 hours**.

The system does not send e-mail (section 9), so give the link to the person yourself. They open it, choose a password and are active from then on. If the link expires, use **New invitation link** on the user's row.

**Other administration**, also under Organization → Users & roles:

- grant or remove roles;
- disable or enable a user;
- unlock a user after too many failed sign-ins;
- issue a password reset link (valid for 30 minutes).

Each of these is audited.

**Passwords** are 12–256 characters long. Repeated failed sign-ins lock the account for a while; an administrator can unlock it sooner.

**Account menu** (the avatar in the top bar):

- Edit profile: name and photo.
- Change password. This signs out every other device.
- Signed-in devices: see and sign out sessions.
- Sign out.

On shared reception PCs, staff should sign out at the end of the shift.

---

## 5. Daily operations

### 5.1 Signing in and switching property

Sign in at the hotel's address with your e-mail and password.

- With one property, you land on its dashboard.
- With several, use the property switcher in the top bar, or Organization → Overview, which has one card per property.

Every page address contains the property code, so a bookmark always opens the same property.

### 5.2 Reservations

Reservations → **New reservation** works through these steps:

1. Dates, party and rooms.
2. Room type and rate, with live availability and the stay total.
3. The guest: search, or create a new profile; optionally a company and a booker.
4. Review and confirm.

The confirmation number has the form `PREFIX-number`. If the connection fails while saving, retrying never creates a second booking.

From the reservation page you can:

- modify dates, party, room type, rate plan and notes (the price is recalculated);
- assign or remove a room;
- add or remove packages;
- change the company;
- cancel, mark as a no-show, or reinstate (each needs a reason).

The history panel shows every change and who made it.

### 5.3 Front desk

**Arrivals** lists today's guests and their state: needs confirmation, no room, room not ready, ready, checked in.

**Check-in** places the guest in a room, choosing or confirming one, and opens folio window 1. A room that is not clean or inspected can be accepted only by a user allowed to override room status, and only with a reason.

**Walk-in** books and checks in at once.

For guests in house you can:

- move them to another room (with a reason code);
- extend the stay;
- check them out.

The **room board** shows every room's occupancy, housekeeping and service state.

**Check-out** confirms the departure. An early departure needs a reason, and the unused nights go back to inventory. If the property requires a zero balance, every folio window must be settled first. The room becomes vacant and dirty, and a cleaning task is created.

**Same-day departure:** the guest checked in today and leaves today (section 7.1).

### 5.4 Guests, companies and loyalty

Guest profiles hold contact details, documents, preferences, notes and stay history. Sensitive fields need an extra permission.

Companies hold corporate and travel-agent accounts with contacts and negotiated rates.

Loyalty holds programs, tiers, memberships and manual point adjustments. Points are not earned automatically (section 10).

### 5.5 Rooms, housekeeping and maintenance

The room board and the housekeeping board show each room's three separate states:

- occupancy;
- housekeeping status: dirty, pick-up, clean or inspected;
- service: out of order or out of service.

Housekeeping managers create and assign tasks; attendants mark rooms clean; inspectors pass or fail them. Departure and stay-over tasks are created automatically.

Maintenance requests can block a room out of order (removed from inventory) or out of service (sellable but not to be used), then return it to service.

Every status change is kept in the room's history.

### 5.6 Billing

Each stay has a folio with one or more windows, for example company charges and guest extras. You can:

- post charges from the charge codes, with the tax worked out automatically;
- take payments (cash, card or bank transfer, recorded only, section 9);
- reverse or adjust a charge with a reason;
- void or refund a payment with a reason;
- settle windows.

**Posted lines are never edited or deleted.** A correction is always a new, linked line, so the folio is a complete record.

### 5.7 Night audit

At the end of the hotel day, a user with `nightaudit:run` opens Night audit. The readiness checks list what blocks the close:

- guests due out still in house;
- arrivals not checked in, when automatic no-shows are off;
- unbalanced folios;
- payment mismatches;
- room status discrepancies.

**Start audit** then:

1. posts room and package charges;
2. applies no-shows and group cut-offs (if enabled);
3. closes the business date;
4. opens the next one.

This is all one database transaction: either everything happens or nothing does.

While the audit runs, postings and front-desk changes at that property are refused with "Night audit is in progress"; other properties are not affected. If an audit fails, the date reopens and nothing is posted. If it is ever left stuck, **Recover** on the run (after 2 minutes) reopens the date (`docs/OPERATIONS.md` §12).

The night audit is started by a person, not by a timer.

### 5.8 Business date

Every property has its own business date. It changes only through the night audit, never with the clock. It is set once at go-live (section 3, step 12).

### 5.9 Global search

Type at least 2 characters in the top-bar search. Results are grouped (guests, reservations, rooms, companies, groups) and contain only what you are allowed to see.

Confirmation numbers can be typed with or without the prefix.

### 5.10 Reports

Reports cover a business-date range of up to 366 days:

- Manager flash, Occupancy, Room type performance;
- Arrivals, Departures, In house, No-shows, Cancellations;
- Room status, Housekeeping;
- Revenue by code, Tax, Payments, Voids and refunds, Adjustments;
- Guest ledger, Ledger roll-forward;
- Rate plan production, Package revenue, Company production, Group production;
- Night audit history, Audit trail.

Each report can be downloaded as CSV with `reports:export`. Financial figures need `reports:financial`.

Organization → Reports compares properties, each in its own currency.

### 5.11 Audit trail

The audit trail is at Property → Reports → Audit trail, and across properties at Organization → Audit trail. It shows who did what, when, why, and what changed.

Each entry shows readable wording first. **Audit reference** shows the exact action code and record reference for auditors.

The audit trail is append-only.

---

## 6. Offline: what works and what needs the internet

When the connection drops, the top bar shows **Offline mode**, and the last saved copy of the front-office view stays readable. The copy is per user and per property, and is refreshed every 10 minutes while online. It shows:

- today's arrivals (up to 200);
- in-house guests and departures (up to 200);
- the room board, with occupancy and housekeeping status.

Offline mode does not store contact details, notes, rates, balances, folios, payments or company data. The copy is erased on sign-out.

**Everything else needs the internet.** That includes every change: check-in, check-out, room moves, reservations, payments, charges, housekeeping updates, setup and night audit.

The application never pretends a change was saved while offline. When the connection returns, the indicator says so and the pages refresh.

---

## 7. Business rules the system enforces

These rules are intentional, not defects.

### 7.1 Same-day departure

A guest who checks in and leaves on the **same business date** has used no night, so this is not a check-out. The stay page offers no **Check out** button for such a stay. Users allowed to reverse a check-in see **Same-day departure** instead. Two cases:

**Nothing has been posted to the folio yet.** A user with `frontdesk:reverse_checkin` (Front Office Manager, General Manager, Organization Admin) can **reverse the check-in**, with a reason. The effect:

- the reservation returns to _Reserved_, with its room kept or released;
- the room becomes vacant, and its housekeeping status is not changed;
- the action is audited as high risk.

Afterwards the booking can be checked in again, amended, or cancelled as usual.

**Something has already been posted** (a charge or a payment). Because posted lines are permanent, the check-in cannot be undone. Settle the folio; the stay is checked out on its departure date, or after the next night audit.

A check-in made on an earlier business date cannot be reversed either; use check-out.

### 7.2 Other rules

- **Ledgers are append-only:**
  - folio lines;
  - cash movements;
  - room status history;
  - the audit trail.
- **Each property's business date moves only through the night audit.** Postings belong to the business date, not the calendar date.
- **Availability is re-checked when you confirm.** Two people booking the last room cannot both succeed. Overbooking needs its own permission and a reason.
- **Someone else's change wins.** If a colleague changed a record after you opened it, your save is refused with "changed by someone else" and you reload. Nothing is silently overwritten.
- **Before go-live, setup is open; after go-live, some settings are fixed.** No reservations can be taken before go-live, and the time zone and confirmation prefix cannot change after it.
- **Room types, floors and rooms are retired, never deleted.** A room type with rooms or bookings, or a room with a guest in house or an assignment, cannot be retired until that is resolved.
- **Tax changes affect only future postings.** End the old tax and add a new one; existing lines keep their tax.
- **Payments are records, not card transactions** (section 9).

---

## 8. Data persistence

Everything you save is stored on the server's database and appears the same after a page refresh, on another device and for colleagues:

- guests, companies and loyalty;
- reservations, stays and rooms;
- housekeeping, maintenance, charges, payments and folios;
- rates, packages, groups and blocks;
- setup, the audit trail and night-audit runs.

Only these are kept in the browser:

- the offline copy (section 6);
- small view preferences.

---

## 9. Known external dependencies

The application works fully without the services below. Connecting them is a separate project with the provider. None of them is a defect.

| Dependency                           | Current behaviour                                                                                                                                                                                                                                                                                                               | What the client provides                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Payment provider / card terminal** | Payments are **recorded** against the folio (method, amount, reference), not processed. Card authorization, capture and refunds happen on the hotel's terminal or gateway, and the reference is entered in the PMS. No card numbers are stored. The integration outbox already records payment events for a future connector    | A contract with a payment gateway or acquirer; then an integration project                                                              |
| **E-mail / SMS delivery**            | Invitation and password reset links are shown to the administrator, who passes them on. There is no self-service "forgot password" e-mail. Confirmations are not e-mailed to guests                                                                                                                                             | An e-mail or SMS provider account                                                                                                       |
| **Hosting infrastructure**           | Hosting is not part of the application handover. The application is built and documented for deployment, but the client or hosting provider must provide and operate:<br>• servers<br>• domain and DNS<br>• TLS certificates<br>• the production PostgreSQL database<br>• a reverse proxy<br>• monitoring<br>• off-site backups | Hosting according to `docs/DEPLOYMENT.md` §9–§11 and `docs/OPERATIONS.md`                                                               |
| **Credentials and secrets**          | Never in the code or the repository. Generated and kept by the client's IT                                                                                                                                                                                                                                                      | `DATABASE_URL`, `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_SECRET`, `FIELD_ENCRYPTION_KEY` and the rest of `docs/DEPLOYMENT.md` §2 |
| **Channel manager / OTA**            | Not connected. Reservations are entered in the PMS                                                                                                                                                                                                                                                                              | A channel-manager contract; then an integration project                                                                                 |
| **Accounting system**                | Not connected. Use the Reports CSV exports                                                                                                                                                                                                                                                                                      | Chart-of-accounts mapping; then an integration project                                                                                  |

---

## 10. Post-handover enhancements

These are outside the delivered scope. The application does not pretend to have them: no buttons, placeholder screens or fake data stand in for them. Their permissions exist in the catalog only as reserved keys.

- **Configuration screens:**
  - charge codes and payment methods beyond the starter set;
  - custom role editing;
  - per-user language.
- **Rates and pricing:**
  - manual rate override and discounts on a reservation;
  - member-only and day-use rates.
- **Front office:**
  - room holds and upgrades;
  - guest messages;
  - lost and found;
  - guest profile merge and privacy requests;
  - group rooming-list import.
- **Billing:**
  - cashier shifts and paid-outs;
  - foreign-currency payments;
  - invoices and credit notes;
  - deposits;
  - billing routing;
  - group master folios.
- **Loyalty and commissions:**
  - automatic loyalty point earning;
  - commissions.
- **Offline:** changes while offline (queued and synced later).
- **Integrations:** a publisher for the integration event outbox.
- **Security hardening:**
  - field-level encryption of selected guest data;
  - refresh-token family tracking (`docs/PRODUCTION_READINESS.md` P2-1).

---

## 11. Support checklist for the hotel

- Keep at least two people with `nightaudit:run`, and one with `properties:manage` and `users:manage`.
- Sign out on shared PCs, and review **Signed-in devices** if an account may have been misused.
- When a user leaves, disable them under Users & roles.
- Ask IT to confirm the nightly backup, and to test a restore every quarter (`docs/OPERATIONS.md` §2).
- Report problems with the **request id** shown on error screens. It lets IT find the exact server log entry.
