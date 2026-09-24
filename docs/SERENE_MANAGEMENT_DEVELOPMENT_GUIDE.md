# SERENE MANAGEMENT — Development Guide

## 0. Purpose

SERENE MANAGEMENT is a web-based Hotel Property Management System (PMS) built for hotel operations.

The product takes Oracle Hospitality OPERA Cloud and OPERA PMS as the primary functional reference. The goal is to reproduce the depth of hotel-management workflows and operational coverage while creating an original SERENE MANAGEMENT product, information architecture, visual language, database model, and implementation.

OPERA references:

- Oracle Hospitality OPERA Cloud official documentation:
  https://docs.oracle.com/en/industries/hospitality/opera-cloud/
- Oracle Hospitality Hotels documentation:
  https://docs.oracle.com/en/industries/hospitality/hotels.html
- Oracle OPERA Cloud PMS overview:
  https://www.oracle.com/hospitality/hotel-property-management/
- Oracle OPERA Cloud 26.1 User Guide:
  https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.1/ocsuh/
- Oracle OPERA Cloud 24.2 table of contents:
  https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/toc.htm
- Oracle OPERA 5 PMS documentation:
  https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/welcome_to_pms.htm
- Oracle Hospitality Integration Platform:
  https://www.oracle.com/hospitality/integration-platform/

Claude MUST use these official Oracle references to understand functional coverage and workflows. Do not copy Oracle source code, proprietary assets, trademarks, screenshots, or exact UI designs. Implement equivalent business capabilities with original SERENE MANAGEMENT UX and architecture.

---

# 1. Mandatory Technology Stack

## Frontend

- Next.js 16
- App Router
- React 19
- TypeScript
- Tailwind CSS v4

## Client state

- Zustand for client/UI state
- RTK Query for server state and API caching

## Backend

Use a modular backend architecture.

Preferred initial approach:

- Next.js application
- Route handlers / server-side API boundary where appropriate
- Dedicated service/domain layer
- Prisma ORM
- PostgreSQL

If the project is split into frontend and backend later, preserve the same domain boundaries and API contracts.

## Database

- PostgreSQL
- Prisma
- Prisma migrations
- Seed data for development/demo environments

## Validation

- Zod
- Shared schemas for forms and API contracts

## Charts

- Recharts

## Authentication

- JWT access/refresh token architecture
- HTTP/API authorization
- `proxy.ts` for protected route gating
- Server-side authorization remains the final authority

## Other

- ESLint
- Prettier
- strict TypeScript
- environment variables through `.env`
- Docker-ready development
- production build must pass without TypeScript or lint errors

---

# 2. Primary Product Objective

SERENE MANAGEMENT must operate as a serious hotel PMS.

The application must support:

- Single-property hotels
- Multi-property organizations
- Hotel staff
- Front desk
- Reservations
- Housekeeping
- Maintenance
- Management
- Finance/cashiering
- Guest services
- Reporting
- Administration

The system must support the complete guest lifecycle:

Reservation
→ Pre-arrival
→ Room assignment
→ Check-in
→ In-house stay
→ Charges/services
→ Room changes/extensions
→ Payment
→ Check-out
→ Housekeeping
→ Room available

---

# 3. Product Scope

Build the product around these functional domains.

## 3.1 Dashboard

Provide configurable operational dashboards.

Required information:

- Occupancy
- Arrivals
- Departures
- Stayovers
- No-shows
- Cancellations
- Available rooms
- Dirty rooms
- Clean rooms
- Inspected rooms
- Out-of-order rooms
- Out-of-service rooms
- Revenue
- ADR
- RevPAR
- Room revenue
- Cashier activity
- Outstanding balances
- VIP arrivals
- Special requests
- Maintenance alerts
- Housekeeping alerts

Dashboard widgets must support drill-down into the underlying records.

---

# 4. Front Desk

Front Desk is one of the core PMS workspaces.

Required capabilities:

- Arrival list
- Departure list
- In-house guest list
- Expected arrivals
- Expected departures
- Walk-in guest
- New reservation
- Reservation search
- Guest search
- Room search
- Available room search
- Room assignment
- Manual room assignment
- Auto room assignment
- Room move
- Room swap
- Room shift
- Room hold
- Pre-registration
- Advance check-in
- Check-in
- Mass check-in
- Check-out
- Early check-out
- Reinstatement of checked-out stay
- No-show processing
- Cancellation processing
- Extend stay
- Shorten stay
- Wake-up call
- Guest messages
- Guest alerts
- Guest requests
- Registration card
- Key packet information
- Guest notes
- VIP identification

---

# 5. Reservations

Reservations are a central domain.

Required capabilities:

- Create reservation
- Modify reservation
- Cancel reservation
- Reinstate reservation
- Copy reservation
- Search reservations
- Reservation confirmation
- Confirmation number
- Reservation history
- Reservation traces
- Reservation alerts
- Reservation notes
- Guest profile association
- Company profile association
- Travel agent association
- Source profile association
- Group association
- Room type
- Rate plan
- Packages
- Market code
- Source code
- Channel
- Adults
- Children
- Arrival date/time
- Departure date/time
- Number of nights
- Number of rooms
- Preferences
- Special requests
- Deposit requirements
- Advance payments
- Cancellation rules
- No-show rules
- Guarantee rules
- Room assignment
- Multiple room reservations
- Multi-segment reservations
- Reservation history/audit
- Confirmation letters
- Registration cards

Search must support:

- Guest name
- Confirmation number
- Room
- Company
- Group
- Travel agent
- Source
- Reservation status
- Arrival/departure date
- Reservation type

---

# 6. Availability and Look-to-Book

Create a hotel availability engine.

Required capabilities:

- Search by date range
- Search by room type
- Search by rate
- Search by occupancy
- Search across properties
- Availability grid
- Sellable availability
- Physical inventory
- Remaining inventory
- Room type availability
- Rate availability
- Restrictions
- Minimum length of stay
- Maximum length of stay
- Closed for arrival
- Closed for departure
- Stop sell
- Sell limits
- Overbooking configuration
- Room-type pooling
- Availability by property
- Availability by date
- Availability by rate plan

Look-to-book must allow staff to search inventory and create a reservation from the availability result.

---

# 7. Rate Management

Support a full hotel rate structure.

Required capabilities:

- Rate plans
- Base rates
- Seasonal rates
- Daily rates
- Occupancy-based rates
- Derived rates
- BAR rates
- Corporate rates
- Negotiated rates
- Group rates
- Package rates
- Promotional rates
- Member rates
- Child rates
- Extra-person rates
- Weekend rates
- Date-specific rates
- Rate restrictions
- Rate availability
- Rate hierarchy
- Rate code
- Rate category
- Currency
- Tax-inclusive/exclusive configuration
- Rate overrides
- Rate history

Every rate-affecting change must be auditable.

---

# 8. Packages and Promotions

Support:

- Room packages
- Meal packages
- Breakfast
- Lunch
- Dinner
- Transport
- Spa
- Activities
- Amenities
- Promotional packages
- Package pricing
- Package components
- Package schedules
- Package posting rules
- Package availability
- Package restrictions

Packages must integrate with reservations and folios.

---

# 9. Guest Profiles

Guest profile management must be comprehensive.

Required:

- Individual profile
- Company profile
- Travel agent profile
- Source profile
- Group profile
- Contact information
- Address
- Email
- Phone
- Nationality
- Identification
- Passport/ID information
- Preferences
- Communication preferences
- VIP status
- Membership
- Loyalty status
- Guest notes
- Guest history
- Stay history
- Reservation history
- Billing history
- Preferences history
- Special requests
- Profile merge
- Duplicate detection
- Profile restrictions
- Privacy controls

Guest profiles must become the central source of guest history.

---

# 10. Guest Recognition

Support operational guest recognition.

Display appropriate indicators for:

- VIP
- Returning guest
- First-time guest
- Loyalty member
- Restricted guest
- Special occasion
- Special preference
- Important guest notes

Do not expose sensitive information to staff without appropriate permission.

---

# 11. Room and Property Management

Property configuration must support:

- Property
- Buildings
- Floors
- Room types
- Rooms
- Suites
- Connecting rooms
- Adjacent rooms
- Accessible rooms
- Room features
- Room attributes
- Room classes
- Room status
- Room conditions
- Room photos
- Floor plans
- Property maps

Room statuses should support at minimum:

- Vacant Clean
- Vacant Dirty
- Occupied Clean
- Occupied Dirty
- Pickup
- Inspected
- Out of Order
- Out of Service
- Maintenance
- Hold

Status transitions must follow business rules.

---

# 12. Room Assignment

Support:

- Manual assignment
- Automatic assignment
- Room type compatibility
- Room feature matching
- Guest preference matching
- Connecting-room requirements
- Accessible-room requirements
- Room holds
- Room moves
- Room swaps
- Room shifts
- Room upgrades
- Room downgrades
- Room assignment conflict detection

Never allow conflicting active room assignments.

---

# 13. Housekeeping

Housekeeping must be a complete operational module.

Required:

- Housekeeping board
- Room status board
- Daily task sheets
- Attendant assignment
- Floor assignment
- Section assignment
- Cleaning priorities
- Departure cleaning
- Stayover cleaning
- Deep cleaning
- Inspection
- Room pickup
- Dirty/clean status
- Room discrepancy management
- Housekeeping forecast
- Room condition
- Maintenance request
- Lost and found
- Linen/service tasks
- Minibar/restocking tasks
- Housekeeping notes
- Staff productivity
- Task completion tracking

Support mobile/tablet-friendly housekeeping workflows.

---

# 14. Maintenance

Required:

- Maintenance requests
- Room maintenance
- Property maintenance
- Priority
- Assignment
- Status
- Notes
- Photos
- Work history
- Preventive maintenance
- Out-of-order rooms
- Out-of-service rooms
- Estimated completion
- Completion records

Maintenance status must integrate with room availability.

---

# 15. Folio and Billing

Billing must support multiple folios per reservation/stay.

Required:

- Folio creation
- Multiple folios
- Folio routing
- Room charges
- Package charges
- Taxes
- Fees
- Discounts
- Service charges
- Adjustments
- Transfers
- Split charges
- Move charges
- Charge routing
- Posting
- Corrections
- Reversals
- Balance calculation
- Folio history
- Folio printing
- Invoice generation

Every financial transaction requires:

- source
- timestamp
- user
- amount
- currency
- transaction type
- reference
- audit record

Never use floating point numbers for financial values.

Use PostgreSQL decimal/numeric or integer minor units.

---

# 16. Payments

Support:

- Cash
- Credit card
- Debit card
- Bank transfer
- Online payment
- Payment gateway integration
- Advance payment
- Deposit
- Prepayment
- Refund
- Partial payment
- Split payment
- Multiple payment methods
- Payment authorization
- Payment reversal
- Payment history
- Receipt generation

Card data must never be stored directly.

Use tokenized payment-provider integrations.

---

# 17. Cashiering

Support:

- Cashier login
- Cashier shift
- Opening balance
- Cash transactions
- Cash drops
- Cashier closure
- Paid-outs
- Postings
- Refunds
- Receipts
- Payment reconciliation
- Cashier reports
- Cashier audit

---

# 18. Night Audit

Night audit is a mandatory PMS domain.

Required workflow:

1. Validate open transactions
2. Validate room status
3. Validate departures
4. Validate arrivals
5. Validate balances
6. Post recurring room charges
7. Post package charges
8. Post taxes
9. Process no-shows according to configuration
10. Process automatic postings
11. Close business date
12. Advance hotel business date
13. Generate audit reports
14. Record audit results

Night audit must be transactional and recoverable.

Never allow partial business-date closure.

---

# 19. Group Management

Support:

- Group profile
- Group reservation
- Group block
- Room block
- Block dates
- Block inventory
- Group rate
- Group cutoff date
- Group pickup
- Group rooming list
- Rooming list import
- Group billing
- Group folio
- Group deposits
- Group cancellation
- Group check-in
- Group check-out
- Group reports
- Sales owner

---

# 20. Companies, Travel Agents, and Sources

Support profiles for:

- Companies
- Corporate accounts
- Travel agencies
- Booking sources
- OTAs
- Wholesalers
- Partners

Track:

- Production
- Reservations
- Revenue
- Commission
- Contracts
- Rates
- Contacts
- History

---

# 21. Commissions

Support:

- Commission rules
- Commissionable rates
- Travel-agent commission
- Company commission
- Commission amount
- Commission status
- Commission reporting
- Commission reconciliation

---

# 22. Loyalty

Design the data model to support:

- Loyalty programs
- Membership tiers
- Points
- Point earning
- Point redemption
- Member rates
- Rewards
- Membership history
- Multi-property recognition

Loyalty must remain modular so the core PMS does not depend on one loyalty implementation.

---

# 23. Sales and Catering Integration Boundary

SERENE MANAGEMENT should have architecture ready for future:

- Sales leads
- Events
- Conferences
- Banquets
- Function spaces
- Catering
- Room blocks
- Event billing

These features should be designed as a separate bounded domain rather than mixed into reservations.

---

# 24. Inventory / Items

For hotel operational inventory, support an extensible item model for:

- Minibar items
- Amenities
- Housekeeping supplies
- Linen
- Maintenance supplies
- Retail items

Track:

- SKU
- item
- category
- quantity
- unit
- cost
- location
- stock movement
- adjustment
- consumption

Full Materials Control/ERP inventory is outside the initial PMS core, but the architecture must permit later integration.

---

# 25. Reports and Analytics

Reports must be server-side generated.

Core reports:

- Occupancy
- ADR
- RevPAR
- Room revenue
- Total revenue
- Arrivals
- Departures
- Stayovers
- No-shows
- Cancellations
- Pickup
- Room status
- Housekeeping
- Maintenance
- Guest history
- Reservation production
- Source production
- Company production
- Travel agent production
- Rate production
- Cashier
- Payment
- Folio
- Tax
- Deposit
- Commission
- Night audit
- Financial summaries

Reports must support:

- Date filters
- Property filters
- Room type filters
- Rate filters
- Source filters
- Export
- Print
- Scheduled generation
- Role-based access

Use database aggregation.

Do not load huge datasets into JavaScript merely to calculate totals.

---

# 26. Multi-Property Architecture

The database must be multi-property ready from day one.

Core records should support:

- Organization
- Property
- Property-specific configuration
- Property-specific rooms
- Property-specific rates
- Property-specific inventory
- Property-specific users/permissions where required
- Central guest profiles
- Central/company profiles
- Cross-property reservations where supported

Every property-sensitive query must include the appropriate property scope.

Never trust a client-provided property ID without server-side authorization.

---

# 27. Authentication

Implement:

- Login
- Logout
- Refresh tokens
- Password reset
- Session management
- Account lockout rules
- Secure password hashing
- Role-based authorization
- Permission-based authorization
- Property-level access
- Audit logging

Use `proxy.ts` for route gating.

The API/server remains the authority.

---

# 28. RBAC

Permissions should follow:

`resource:action`

Examples:

- `reservations:read`
- `reservations:create`
- `reservations:update`
- `reservations:cancel`
- `frontdesk:checkin`
- `frontdesk:checkout`
- `rooms:assign`
- `rooms:update_status`
- `housekeeping:update`
- `billing:post`
- `billing:adjust`
- `payments:refund`
- `nightaudit:run`
- `reports:read`
- `users:manage`
- `settings:manage`

Roles may include:

- Super Admin
- Organization Admin
- General Manager
- Front Office Manager
- Front Desk Agent
- Reservations Agent
- Housekeeping Manager
- Housekeeper
- Maintenance Manager
- Maintenance Staff
- Cashier
- Accountant
- Auditor
- Read Only

Permissions must be configurable.

---

# 29. Audit Logging

Audit logs are mandatory.

Record:

- user
- property
- timestamp
- action
- resource
- resource ID
- previous value
- new value
- IP where appropriate
- user agent where appropriate
- reason/comment where required

Audit records must be append-only for business users.

High-risk actions require stronger audit information:

- payment changes
- refunds
- rate changes
- reservation cancellation
- room changes
- folio adjustments
- user permission changes
- night audit
- business date changes
- configuration changes

---

# 30. Business Date

Hotel business date is distinct from server calendar date.

Implement:

- Current business date
- Business date configuration
- Business-date transactions
- Business-date reports
- Night audit transition
- Business-date history

All operational transactions must use the correct property business date.

---

# 31. Time Zones

Each property must have its own timezone.

Store timestamps safely and convert at the property/user display boundary.

Do not assume server timezone equals hotel timezone.

---

# 32. Localization

Architecture must support:

- English
- Urdu
- Arabic
- RTL layouts

All user-facing strings must be externalizable.

Do not hardcode language-specific text inside business logic.

---

# 33. Frontend Architecture

Rule:

Everything belonging to one route stays inside that route.

Example:

```text
app/(dashboard)/reservations/
├── page.tsx
├── components/
├── hooks/
├── lib/
│   ├── reservations.api.ts
│   └── reservations.schema.ts
├── store/
├── utils/
└── types.ts
```

Global folders are only for genuinely shared functionality.

Litmus test:

"Is this used by two or more routes?"

If no, keep it local.

If yes, consider promoting it to global.

---

# 34. Global Frontend Structure

```text
components/
└── ui/
    ├── Button
    ├── Input
    ├── Select
    ├── Dialog
    ├── Drawer
    ├── Table
    ├── DatePicker
    ├── Tabs
    ├── Badge
    ├── Tooltip
    ├── CommandMenu
    └── DataTable

hooks/
├── usePermissions.ts
├── useProperty.ts
└── useBusinessDate.ts

lib/
├── api/
│   ├── baseApi.ts
│   └── store.ts
├── auth/
├── permissions/
├── validation/
├── db/
└── utils/

store/
├── auth.store.ts
├── ui.store.ts
└── property.store.ts

types/
└── shared domain types
```

---

# 35. Component Rules

Components must normally remain below 200–300 lines.

Split large components into:

- sub-components
- hooks
- utility functions
- domain services

Do not create one 800-line reservation page.

Pages should compose components.

Pages should not contain large business logic.

---

# 36. State Management

## Zustand

Use Zustand for:

- sidebar state
- UI preferences
- selected property
- selected rows
- modal state
- multi-step form drafts
- temporary UI state

Do not store server records in Zustand.

## RTK Query

Use RTK Query for:

- reservations
- guests
- rooms
- availability
- rates
- folios
- payments
- housekeeping
- maintenance
- reports
- users
- permissions

Use one shared `baseApi`.

Use `injectEndpoints` inside domains.

Every result-changing parameter must form part of the query key.

Use `providesTags` and `invalidatesTags`.

---

# 37. Database Rules

Mandatory:

- PostgreSQL
- Prisma
- migrations
- indexes
- foreign keys
- unique constraints
- check constraints where appropriate
- transactions for critical workflows
- decimal/numeric for money
- timestamps
- soft-delete only where appropriate

Never use JavaScript floats for money.

Never rely solely on frontend validation.

---

# 38. Query Performance

Never:

- fetch all rows and `.reduce()` in JavaScript
- run database queries inside loops
- create N+1 queries
- select every column when only two are needed
- use unbounded parallel database requests
- return huge unpaginated datasets

Always:

- aggregate in PostgreSQL
- use `select`
- batch related queries
- paginate
- index hot filters/sorts
- inspect query plans for expensive reports
- cache expensive read operations where appropriate

---

# 39. API Rules

Each domain must expose clear service boundaries.

Example:

```text
reservations/
├── reservations.service.ts
├── reservations.repository.ts
├── reservations.schema.ts
├── reservations.types.ts
└── reservations.routes.ts
```

Do not put all application logic into route handlers.

Route handlers should:

1. Authenticate
2. Authorize
3. Validate
4. Call service
5. Return structured response

---

# 40. Transactional Workflows

Critical hotel operations must use database transactions.

Examples:

Check-in:

Reservation validation
→ room validation
→ room assignment
→ stay creation/update
→ reservation status update
→ room status update
→ audit log

Check-out:

folio validation
→ payment/balance validation
→ checkout
→ reservation/stay status update
→ room status transition
→ housekeeping task
→ audit log

Night audit:

validate
→ post
→ close business date
→ advance date
→ audit
→ commit

A partial workflow must not leave the PMS in an inconsistent state.

---

# 41. Real-Time Operations

Design the system for real-time updates.

Potential mechanisms:

- WebSockets
- Server-Sent Events
- polling where appropriate
- RTK Query invalidation

Important real-time areas:

- Room status
- Housekeeping
- Front desk
- Reservation changes
- Maintenance
- Payment status
- Availability

---

# 42. Search

Global search should support:

- Guest
- Reservation
- Confirmation
- Room
- Company
- Travel agent
- Group
- Folio

Search must be fast and indexed.

Provide keyboard-friendly access.

Recommended shortcut:

`Ctrl/Cmd + K`

---

# 43. UI/UX Direction

SERENE MANAGEMENT must look like enterprise hospitality software.

Avoid:

- generic SaaS gradients
- excessive rounded cards
- oversized dashboard numbers
- decorative animations
- purple startup styling
- excessive whitespace in operational screens

Prefer:

- dense information layouts
- strong typography
- clear hierarchy
- excellent tables
- command/search workflows
- split panels
- room grids
- date grids
- status indicators
- keyboard-friendly actions
- fast navigation
- contextual action panels

The interface should feel premium, professional, fast, and operational.

SERENE branding must remain distinct from Oracle OPERA.

---

# 44. Responsive Design

Primary target:

- Desktop
- Laptop
- Hotel front-desk terminals

Secondary:

- Tablet
- Mobile operational workflows

Housekeeping and maintenance must work well on tablets/mobile.

Front desk and room-rack workflows must remain usable on smaller laptop screens.

---

# 45. Accessibility

Implement:

- keyboard navigation
- visible focus states
- semantic HTML
- ARIA where needed
- sufficient contrast
- accessible dialogs
- accessible tables
- screen-reader labels
- reduced-motion support

---

# 46. Security

Mandatory:

- server-side authorization
- property scoping
- secure authentication
- password hashing
- refresh token security
- input validation
- SQL injection protection through Prisma/parameterized queries
- CSRF considerations where applicable
- rate limiting
- audit logs
- secure headers
- environment secrets
- no secret values in client bundles

Payment card data must never be stored directly.

---

# 47. Error Handling

Every API should return consistent structured errors.

Frontend must provide:

- inline validation
- actionable error messages
- loading states
- empty states
- retry states
- permission denied states
- optimistic updates only where safe

Do not silently swallow errors.

---

# 48. Seed / Demo Data

Create realistic development data.

Include:

- multiple properties
- floors
- room types
- rooms
- guests
- companies
- travel agents
- reservations
- arrivals
- departures
- in-house guests
- rates
- packages
- folios
- payments
- housekeeping tasks
- maintenance requests
- users
- roles
- permissions

The demo environment must immediately show a believable hotel operation.

---

# 49. Development Phases

Do not build every screen simultaneously.

## Phase 0 — Architecture

Complete:

- project setup
- folder structure
- design system
- database architecture
- authentication architecture
- RBAC
- API conventions
- error handling
- logging
- seed strategy

Do not build feature screens before Phase 0 is stable.

## Phase 1 — Property Core

- organization
- properties
- buildings
- floors
- room types
- rooms
- room statuses
- configuration

## Phase 2 — Guests

- guest profiles
- companies
- agents
- sources
- guest history

## Phase 3 — Reservations

- reservation engine
- availability
- rates
- packages
- room assignment
- modifications
- cancellations

## Phase 4 — Front Desk

- arrivals
- departures
- room rack
- check-in
- check-out
- room moves
- walk-ins

## Phase 5 — Housekeeping

- board
- task sheets
- assignments
- room statuses
- inspections
- discrepancies

## Phase 6 — Billing and Cashiering

- folios
- charges
- routing
- payments
- refunds
- cashier
- invoices

## Phase 7 — Night Audit

- audit workflow
- business date
- automatic postings
- reconciliation

## Phase 8 — Groups

- groups
- blocks
- rooming lists
- group billing

## Phase 9 — Reporting

- operational reports
- financial reports
- occupancy
- ADR
- RevPAR
- exports
- scheduling

## Phase 10 — Advanced PMS

- loyalty
- commissions
- advanced rate management
- multi-property
- integrations
- mobile workflows
- advanced configuration

---

# 50. Integration Architecture

Design integration boundaries from the beginning.

Future integrations may include:

- Payment gateways
- POS
- OTA/channel managers
- Booking engines
- Accounting systems
- ID/document scanning
- Door locks
- Telephony
- Email
- SMS
- WhatsApp
- Revenue management
- Loyalty
- CRM
- BI/analytics

Do not tightly couple external integrations to core PMS logic.

---

# 51. Oracle OPERA Functional Reference

Claude should continuously use official Oracle documentation as a functional reference.

Important reference areas include:

### OPERA Cloud

https://docs.oracle.com/en/industries/hospitality/opera-cloud/

### Reservations

https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/c_about_reservations.htm

### Front Desk / User Guide

https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.5/ocsuh/

### OPERA Cloud Table of Contents

https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/toc.htm

### Housekeeping / Room Management

https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.5/ocsuh/c_housekeeping_room_management.htm

### OPERA 5 PMS

https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/welcome_to_pms.htm

### Oracle Hospitality Integration Platform

https://www.oracle.com/hospitality/integration-platform/

Use these references to identify workflows and functional requirements.

Do not reproduce Oracle copyrighted text or proprietary implementation.

---

# 52. Functional Completeness Rule

When implementing a module, Claude must ask:

1. What does the corresponding OPERA workflow support?
2. What records does the workflow create or modify?
3. What permissions are required?
4. What validations are required?
5. What happens to room inventory?
6. What happens to billing?
7. What happens to guest history?
8. What happens to housekeeping?
9. What happens to audit logs?
10. What reports depend on this data?
11. What happens across multiple properties?
12. What happens during failure or rollback?

A screen is NOT considered complete because it visually exists.

A feature is complete only when its underlying workflow, validation, persistence, permissions, audit trail, and dependent operations work.

---

# 53. Definition of Done

Every feature must satisfy:

1. Database model completed.
2. Migration created.
3. Server/service logic completed.
4. API endpoint completed.
5. Authentication implemented.
6. RBAC implemented.
7. Zod validation implemented.
8. RTK Query endpoint implemented.
9. Cache tags implemented.
10. UI completed.
11. Loading state completed.
12. Empty state completed.
13. Error state completed.
14. Permission state completed.
15. Audit logging completed where required.
16. Related modules updated.
17. Reports considered.
18. Mobile/tablet behavior considered.
19. Accessibility considered.
20. Tests added.
21. Seed/demo data updated.
22. TypeScript passes.
23. Lint passes.
24. Production build passes.

---

# 54. Agent Rules for Claude

Claude MUST:

- Read this entire document before coding.
- Inspect the existing repository before changing architecture.
- Never create duplicate global components.
- Never create giant components.
- Never bypass RBAC.
- Never trust client-provided property scope.
- Never store server data in Zustand.
- Never put business logic inside presentation components.
- Never use floating point for money.
- Never fetch huge datasets without pagination.
- Never create N+1 database queries.
- Never silently remove existing functionality.
- Never change database schema without a migration.
- Never modify unrelated files without reason.
- Keep commits/work units logically scoped.
- Run type checking after substantial changes.
- Run linting after substantial changes.
- Run production build before declaring a milestone complete.
- Update documentation when introducing a new domain or architectural pattern.

---

# 55. Most Important Agent Rule

Do not optimize for number of screens.

Optimize for complete hotel workflows.

A complete reservation workflow is more important than ten unfinished pages.

A complete check-in workflow is more important than a beautiful dashboard.

A correct folio/payment model is more important than decorative UI.

Build the operational engine first, then refine the visual system.

---

# 56. Final Product Standard

SERENE MANAGEMENT should eventually provide a complete PMS experience covering:

Reservations
→ Availability
→ Rates
→ Guests
→ Profiles
→ Room assignment
→ Front desk
→ Check-in
→ In-house operations
→ Housekeeping
→ Maintenance
→ Billing
→ Folios
→ Payments
→ Cashiering
→ Check-out
→ Night audit
→ Groups
→ Companies
→ Travel agents
→ Packages
→ Commissions
→ Loyalty
→ Reports
→ Multi-property operations
→ Integrations
→ Administration
→ Audit

The system should be architected so additional hospitality modules can be added without rewriting the PMS core.
