# Nginap → SERENE UI mapping

UI/UX overhaul, direction rework. The visual and UX reference is the Nginap Hotel Management Admin Dashboard shot on Dribbble (Rian Darma for Pixelz, shot 22730757), reviewed on 29 September 2026. It is used for **principles only**. No code, assets, illustrations, copy or exact layouts are taken from it.

The reference board shows these screens:

- dashboard;
- booking list and booking detail;
- booking calendar/timeline;
- room list;
- guest list and guest detail;
- messages;
- an "Add new booking" form.

Token values and component rules live in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). This document explains **why** the product looks the way it does, and **how** each SERENE screen maps to a reference pattern.

**Status (this batch):** app shell and dashboard are implemented. Every other screen below is the plan for the module batches.

## 1. Visual principles

What we take from Nginap:

- **Calm canvas, crisp cards.** A pale neutral background with white rounded cards. Hierarchy comes from space and type, not from colour blocks.
- **One confident green for action and selection.** The primary button, the active navigation item, the selected day and the key progress all use it. Everything else stays neutral.
- **Compact key figures.** A small tinted icon tile, a label and a bold number, arranged four across. The figures are compact and never the page's hero.
- **Operational content first.** Schedules, lists and room states sit directly under the figures; charts support rather than dominate.
- **Consistent line icons** in navigation, figures and actions.
- **Clear actions.** One primary action top-right of the page header (e.g. "Create new booking"); secondary actions are quiet.

What SERENE deliberately does differently:

- **Light, like the reference (visual correction, 29 Sep 2026).** A pale mint navigation panel, white top bar and cards, a cool off-white canvas. An earlier pass used a dark forest rail and followed the OS dark setting; both were reversed because the product must read light and airy. SERENE keeps its own wordmark, grouped navigation and brass for VIP/loyalty.
- **The green is fresh but accessible** (`#15823c`): slightly deeper than Nginap's, so that white button text (4.9:1) and green text on the mint tint (4.6:1) stay readable.
- **Density is higher.** Front-desk staff scan dozens of rows; tables stay tables, with 40 px rows.
- **Light by default, always.** The dark theme exists only as an explicit opt-in (`data-theme="dark"`); a dark operating-system setting no longer turns the PMS dark.
- **No room photography or decorative imagery.** SERENE has no room images in its data, and the brief rules out fake data.

## 2. Navigation structure

|                          |                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current (before)**     | Dark rail with 12 ungrouped items; active item marked with a brass icon on a raised tone; 56 px top bar; OS dark mode applied automatically.                          |
| **Nginap pattern**       | Left rail with logo, icon + label items, a solid green active pill, and logout at the bottom. Top bar with search, notifications and an avatar showing name and role. |
| **SERENE (implemented)** | See below.                                                                                                                                                            |

**Rail.** The rail is a 240 px pale mint panel (`#eef4f0`, hairline border), with a green monogram tile and the SERENE wordmark at the top. Items are grouped under quiet sentence-case headings:

| Group             | Items                                                             |
| ----------------- | ----------------------------------------------------------------- |
| Front office      | Dashboard, Front desk, Reservations, Availability, Guests, Groups |
| Rooms             | Housekeeping, Maintenance                                         |
| Revenue & finance | Rates, Billing, Night audit, Reports                              |

Inactive items are charcoal-gray text with gray icons; hover is a slightly deeper mint. The active item is a solid green pill with white text. Items are 40 px tall, 44 px on touch screens.

**Top bar.** It is 64 px tall and holds:

- the workspace/property switcher;
- reservation search, a field from `xl` and an icon link below that;
- the business-date badge;
- the account menu: an avatar, plus name and organization from `lg`.

**Collapse.** On `lg` and up, a Collapse button at the foot of the rail shrinks it to a 72 px icon rail. The logo becomes the S mark, group headings become hairline dividers, and labels remain as tooltips and accessible names. The choice is remembered per browser (`localStorage`, `components/workspace/rail.ts`), and the drawer is never collapsed.

**Mobile.** Below `lg`, the rail becomes a drawer (native `<dialog>`, focus trapped, Escape closes).

**Permissions and search.** Item visibility uses exactly the same permission checks as before; grouping is presentation only. The organization workspace uses the same rail without groups (6 items).

There is **no notifications bell and no role label**: the API has no notifications endpoint and the session carries no role names. They will be added only when real data exists. Search uses the existing reservation search (`/reservations?q=`), which covers guest names and confirmation numbers.

## 3. Typography hierarchy

The typeface is IBM Plex Sans, used in 3 weights. Nginap uses a geometric sans; Plex keeps SERENE's own voice and Arabic/Urdu support.

| Level      | Size / weight     | Use                                                    |
| ---------- | ----------------- | ------------------------------------------------------ |
| Page title | 24 / 600, −0.01em | `PageHeader` h1 (Nginap-scale title)                   |
| Key figure | 24 / 600, tabular | `StatCard` value, donut centre                         |
| Card title | 16 / 600          | `Card` header, dialogs, drawers                        |
| Body       | 14 / 400          | Descriptions, forms                                    |
| Data       | 13 / 400–500      | Table cells, lists, controls                           |
| Label      | 12 / 500          | Field labels, stat labels, badges, rail group headings |
| Meta       | 11 / 400          | Chart ticks, references                                |

Breadcrumbs (12 px) sit above the page title, as Nginap's "Home › …" does. There are no uppercase tracked eyebrows.

## 4. Color system

The strategy is restrained: tinted neutrals plus one green, used for action, selection and state.

| Role                                                   | Light (default)                                                    | Dark (opt-in only)       |
| ------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| Canvas                                                 | `#f5f8f6` cool off-white                                           | `#0d1310`                |
| Surface (cards, top bar)                               | `#ffffff`                                                          | `#141c18`                |
| Secondary surface (wells, table headers, search field) | `#edf3ef` pale mint-gray                                           | `#0a0f0c`                |
| Navigation panel                                       | `#eef4f0` pale mint, border `#dfe8e3`                              | `#09110d`                |
| Borders                                                | `#e3ebe6` subtle, `#d3ded7` default, `#879690` form controls (3:1) | darker equivalents       |
| Brand (primary, active, links)                         | `#15823c` fresh green (4.9:1 with white), hover `#126d33`          | `#5fbf95` with dark text |
| Brand tint (selected, badges)                          | `#f0f9f3`; icon tiles `#dcf0e3`                                    | `#15261e`                |
| Text                                                   | charcoal `#1d2521`, secondary `#4f5b55`, muted `#5f6b65`           | light equivalents        |
| Accent (VIP, loyalty)                                  | brass `#8a6420`                                                    | brass `#d6b06c`          |

**Why it looked dark before.**

- `@media (prefers-color-scheme: dark)` switched the whole product to the near-black palette on dark-mode computers.
- The rail tokens (`--sm-nav` `#10231b`, with light rail text) were dark in every theme.
- The brand `#187049` read as deep forest.

All three are changed. The automatic dark block is removed; the dark palette stays available only under `data-theme="dark"`.

Shadows are minimal (`0 1px 2px` at 4 % for cards); elevation comes from white on the off-white canvas plus hairline borders.

Status colours are semantic only:

- success = clean, available, paid;
- warning = due, dirty, pending;
- danger = blocked, out of order, overdue;
- info = arriving, in progress;
- brand = confirmed or selected;
- accent = VIP.

## 5. Spacing system

- 4 px grid.
- **Page padding:** 16 px on mobile, 24 px on tablet, 32 px on desktop. The page header is followed by a 24 px gap.
- **Cards:** 20 px padding, with 24 px gaps between cards (Nginap's generous card spacing). Table rows stay 40 px, which keeps the operational density.

## 6. Radius system

Controls use 8 px, cards/dialogs/table frames 12 px, badges/chips/avatars are round, and the maximum is 16 px. Nginap's rounded but not pill-shaped cards map to 12 px.

## 7. Shadow and elevation

- **Cards:** a hairline border plus a soft two-layer shadow of 2–6 px blur (never a wide blur combined with a border).
- **Hover** on linked cards raises the shadow slightly.
- **Dialogs, drawers and menus:** the overlay shadow.
- **Dark mode:** no card shadow; borders carry the edges.

## 8. Button hierarchy

| Variant    | Use                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Primary    | Solid green with an optional leading icon (`+ New reservation`), one per page header or dialog, placed last     |
| Secondary  | White with a hairline border (`Walk-in`)                                                                        |
| Ghost      | Toolbar and low emphasis                                                                                        |
| Danger     | Destructive commands only                                                                                       |
| IconButton | Icon-only, labelled                                                                                             |
| Text link  | Standalone links such as "View all" and "Open front desk" (`textLinkClass`); brand colour, 24 px minimum target |

## 9. Form patterns

Nginap's "Add new booking" form is sectioned ("Room details", "Guest details"), with labelled fields in a 2–3 column grid and icons inside inputs.

For SERENE, the existing `TextField`/`Select`/`TextArea` keep the label above the control, hint and error below, and an 8 px radius. Rules for form layouts:

- Forms group into titled sections inside one `Card`, not nested cards.
- Grids run 1 column on phones and 2–3 from `md`.
- Leading icons are used only where they aid scanning (search, dates).
- Dates stay native `type="date"`, which gives keyboard entry and the locale's calendar.

## 10. Table patterns

Nginap's room and booking lists are plain rows on white: a light header, status shown as an icon plus coloured text, and generous row height.

For SERENE, the `Table` primitive (`TableFrame` + `THead`/`Th`/`Td`) uses:

- a sunken 36 px header;
- 40 px rows;
- hairline row dividers;
- logical alignment, with numbers end-aligned;
- status as a `Badge` or `StatusDot` (always with text);
- hover on interactive rows.

**Mobile strategy:**

- _Primary lists_ (arrivals, in-house, housekeeping tasks) become **stacked rows**: avatar, name, badge, and a meta line, as in the dashboard's arrivals card.
- _Dense tabular data_ (folios, reports, rate calendar) **scrolls horizontally** inside a labelled, focusable frame.

Tables are never replaced by decorative cards.

## 11. Card patterns

Nginap cards have a title top-left, a small action or menu top-right, no divider, and content directly below.

The SERENE `Card` follows this:

- a 16 px title and optional one-line description;
- actions at the end of the header (text links or small buttons);
- a divider only when the body is an edge-to-edge list or table (`flush`).

Cards are never nested; there is one card per task area.

## 12. Status patterns

- **`Badge`:** a tinted pill in sentence case.
- **`StatusDot`:** for legends and dense columns.
- **`StatCard`:** an icon tile tinted by tone.
- **Room status donut:** occupied vs vacant only, the one exclusive split that adds up. Housekeeping and service states are listed as counts instead of false slices.
- **Operational alerts ("Needs attention"):** a tinted icon square plus a sentence and a link, sorted by severity.

## 13. Dialog and drawer patterns

- **Dialogs** (native `<dialog>`) are for short commands: check-in, post charge, cancel with reason.
- **Drawers** (logical side, RTL-aware) are for record details that keep the list visible, a Nginap-style booking detail as a side sheet, and for mobile navigation.
- **Both:** focus trap, Escape, focus returned to the opener, 12 px radius, and an overlay scrim.

## 14. Responsive rules

| Width | Behaviour                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 375   | Drawer nav. Top bar: menu, switcher (truncated), search icon, date badge, avatar. Stat cards 2 × 2 without icon tiles. Cards stack. Primary actions wrap under the title. |
| 768   | As above with more room: the user name shows from `lg`, search stays an icon.                                                                                             |
| 1024  | Dark rail appears. Dashboard 2 + 1 column grid. Stat cards 2 × 2.                                                                                                         |
| 1440  | Search field in the top bar. Stat cards 1 × 4. Content up to 1600 px.                                                                                                     |

Checked at every width:

- no page-level horizontal overflow;
- dialogs fit the viewport;
- touch targets are at least 24 px (44 px on coarse pointers for controls and navigation).

## 15. Dashboard mapping (implemented)

|                      |                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current (before)** | Property code plus name; a six-cell fact grid (business date, status, local time, time zone, currency, permission count); a sync sentence; six equal tiles; closed-date tiles; a line chart. It had no action items and no arrivals list. |
| **Nginap pattern**   | Breadcrumb and hotel name with a "Create new booking" primary action. Four stat cards (new booking, available room, check in, check out). A booking schedule plus a list, reservation stats and a housekeeping donut.                     |

**SERENE implementation** (`app/(workspace)/[propertyCode]/components/PropertyOverview.tsx` and `components/dashboard/*`):

1. **`PageHeader`:**
   - breadcrumb `SMR › Dashboard`;
   - property name;
   - a status badge (Open / Night audit running / Not live);
   - business date and property time;
   - actions: **Walk-in** (same gate as the front desk) and **New reservation** (`reservations:create`).
2. **Needs attention.** Shown only when something needs it. Derived from live data:
   - night audit overdue, due or running;
   - a business date ahead of the calendar;
   - the property not yet live;
   - arrivals without a room;
   - rooms blocked by maintenance;
   - out-of-order rooms.

   Each item links to the screen that fixes it.

3. **Four `StatCard`s:**
   - occupancy tonight, with a progress bar;
   - arrivals to check in (done/total progress, VIP count);
   - departures due;
   - in house.

   Each links to its report, as before.

4. **Main column:**
   - **Arrivals to check in:** the front desk's own pending list, with avatar, name, VIP, confirmation, room or type, nights, ETA and state badge. Rows open the reservation; the card opens the front desk.
   - **Occupancy trend:** an area chart with a text summary; empty state until two dates are closed.
5. **Side column:**
   - **Room status:** donut plus housekeeping and service counts.
   - **Last closed date:** occupancy, revenue, ADR, RevPAR and open balances, each exactly as permitted before.
   - **Operations:** housekeeping tasks and maintenance requests.
6. **Property details.** The original facts, all kept.

**Data sources.** All data comes from existing endpoints, and each query is skipped without its permission:

- `dashboard` (`dashboard:read`);
- `front-desk/summary` and `front-desk/arrivals?filter=pending` (`frontdesk:read`);
- `housekeeping/summary` (`housekeeping:read`);
- `maintenance/summary` (`maintenance:read`);
- `business-date` (any member).

No figure is invented. The "reservation stats" multi-series chart from Nginap has no backing data in SERENE (there is no booking-pace endpoint), so it is omitted rather than faked.

## 16. Reservation mapping

**Status: implemented (UI/UX Batch 1).**

- List: `PageHeader`; `FilterBar` with status segments and an advanced panel (arrival, departure and booked dates, room type, source, sort, all existing API filters); a table from `xl`; stacked rows below it; skeleton loading.
- Detail: guest-titled header with the confirmation and status; a room card with a stay strip, guest block, `FactList` and nightly-rate table; booking and notes cards; history.
- Booking workflow: `PageHeader` plus `Stepper`.
- Availability (§16 and the booking/calendar row of the screen mapping): header, stay card, `DateNavigator`, a summary of `StatCard`s derived from the response, and room-type row groups (inventory figures, rooms free per night, rates, Book).

|             |                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | URL-synced filter card, a raw results table with cursor pages, a four-step booking workflow with a hand-rolled stepper, and a detail page with a monospace 24 px confirmation title.                    |
| **Nginap**  | A booking list; a booking detail with a back arrow, guest and order id, and a labelled field grid (check-in, check-out, guest, room type, plan, requests, extras); an "Add new booking" sectioned form. |

**SERENE plan.** Reuse: `PageHeader`, `Card`, `Table`, `Badge`, `ToggleGroup`, `Drawer`, `Avatar`, `TextField`/`Select`.

- **List:** filter bar in a `Card`; a `Table` with guest avatar + name, confirmation, stay dates with nights, room/type, status badge and balance; stacked rows on mobile.
- **Detail:** `PageHeader` with back link, the confirmation number as meta, the guest name as title and actions at the end. A field-grid `Card` holds stay facts; room lines and packages go in `Table`s.
- **Workflow:** a shared `Stepper` component (needed; one real use, but it is a standard pattern). Each step is one `Card` with sectioned fields.

## 17. Room Board mapping

|             |                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | `RoomBoardPanel` (shared by the front desk and housekeeping) with hand-rolled tiles and filters.                                            |
| **Nginap**  | A room list with housekeeping status icons (clean, dirty, inspected), front-office status and DND, plus a booking timeline by room and day. |

**SERENE plan:**

- A `RoomStatusCard` component (needed: room number, type, a status stripe as a full-border tint, not a side stripe, occupant or arrival, and task/maintenance icons) in a responsive grid grouped by floor, using the `status-*` tokens.
- A legend with `StatusDot`.
- `ToggleGroup` filters.
- Tile details open in a `Drawer`.
- A timeline view (rooms × dates) remains a later, separate component.

## 18. Guest mapping

|             |                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| **Current** | Guests/companies/loyalty tabs with raw tables. The guest detail page is 593 lines of hand-rolled cards. |
| **Nginap**  | A guest list with avatar rows; a guest detail with a profile header and a labelled fact grid.           |

**SERENE plan:**

- **List:** `Table` with `Avatar` plus name, VIP/loyalty `Badge` (accent), contact, and last or next stay.
- **Detail:** a profile header card (avatar `lg`, name, badges, key contacts, actions); `TabList` for Overview / Stays / Folios / Preferences / Notes; fact grids in `Card`s.
- An `ActivityItem`/`Timeline` component (needed) for notes and history, shared later with audit and maintenance activity.

## 19. Front Desk mapping

|             |                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | Four hand-rolled count tiles acting as view switches; `ListToolbar` (`ToggleGroup` + search); a raw table per view; a hand-styled Walk-in link. |
| **Nginap**  | Check-in/check-out stat cards and booking lists with clear per-row actions.                                                                     |

**SERENE plan:**

- Count tiles become `StatCard`-styled view selectors (`aria-current`), since they are navigation, not tabs.
- A `FilterBar` (needed: `ToggleGroup` + `SearchInput` + optional selects, a pattern shared by reservations, billing and guests).
- `Table` rows carry inline primary actions (Check in / Check out), with stacked rows on mobile.
- Walk-in uses `buttonClass`.

## 20. Housekeeping mapping

|             |                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| **Current** | Room board plus task lists; hand-rolled tab pills and filter chips; the summary is one long subtitle line. |
| **Nginap**  | A housekeeping donut (clean, cleaning, dirty), room rows with status icons.                                |

**SERENE plan:**

- A `StatCard` row: to clean, in progress, awaiting inspection, completed.
- `TabList` for Board / Mine / Open / Inspections / All.
- Board as in §17; task list as a `Table` or stacked rows with a big touch action (tablet workflow, 44 px).

## 21. Billing and Folio mapping

|             |                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| **Current** | Folio list as `div` rows; the folio page has hand-rolled window tabs, a raw ledger table and many dialogs. |
| **Nginap**  | The order-detail pattern: header with back arrow and id, fact grid and totals.                             |

**SERENE plan:**

- `PageHeader` with back link to Billing, the guest as title, and the confirmation plus window status as meta.
- A balance summary strip (`StatCard`s: charges, payments, balance due).
- Folio windows through `TabList` with a balance in each tab.
- The ledger as a `Table` (dates, codes, description, end-aligned money, running totals in a sticky footer).
- Post charge, take payment and settle as header actions opening `FormDialog`s.

## 22. Reports mapping

|             |                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------- |
| **Current** | Hand-rolled catalogue grid; the report view is a raw table with a `← Reports` glyph back link. |
| **Nginap**  | Reservation stats charts inside cards.                                                         |

**SERENE plan:**

- The catalogue groups reports into `Card`s with icon tiles and short descriptions.
- The report view uses `PageHeader` (back link, date-range actions, CSV export), a summary `StatCard` row where the report has totals, charts through `chart.ts` where the data is a series (always with a table below), and a `Table` with a sticky header.

## 23. Settings mapping

|             |                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | No settings screen. Property configuration exists only in the API (`properties/{id}/configuration`); property editing is in Organization › Properties; password change is in the account menu. |
| **Nginap**  | Settings entry in the rail.                                                                                                                                                                    |

**SERENE plan.** No settings entry is added until a real screen exists; adding one would be a feature, not a restyle. When built, it will be a `PageHeader` plus a vertical `TabList` of sections (Property, Configuration, Account) with forms in `Card`s. Settings visibility will use the existing `properties:manage` and settings permissions.

## Screen audit summary (other modules)

| Screen                                                                   | Works                               | Change                                       | Reuse                               | Refine                            | New             |
| ------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------- | ----------------------------------- | --------------------------------- | --------------- |
| Availability                                                             | Clear grid, alerts                  | Hand-rolled card and h1                      | `PageHeader`, `Card`, `Table`       | —                                 | —               |
| Maintenance (list, detail)                                               | Complete flows                      | `div` rows, no empty states, 541-line detail | `Table`, `StatusPanel`, `Card`      | —                                 | `ActivityItem`  |
| Companies / Loyalty                                                      | Complete                            | Raw tables, 5 hand-rolled cards              | `Table`, `Card`, `Badge`            | —                                 | —               |
| Rates (plans, calendar, restrictions, packages)                          | `TabList` already                   | Raw calendar table                           | `Table`, `Card`                     | Sticky-axis grid for the calendar | —               |
| Groups (list, detail)                                                    | `ToggleGroup` already               | Raw tables                                   | `Table`, `Card`, `PageHeader`       | —                                 | —               |
| Night audit (list, run)                                                  | Readiness checks, captioned table   | `←` glyph back link                          | `PageHeader` (back), `Table`        | —                                 | Check-list rows |
| Organization (overview, reports, availability, audit, users, properties) | Scoped data, same shell             | Raw tables, `×` glyph remove button          | `Table`, `IconButton`, `PageHeader` | —                                 | —               |
| Auth (login, reset)                                                      | Accessible forms                    | Hand-rolled card                             | `Card`                              | Brand panel                       | —               |
| Dialogs and forms                                                        | Native `<dialog>`, focus management | —                                            | `Dialog`, `FormDialog`              | Sectioned layouts                 | —               |
| Loading and empty states                                                 | `StatusPanel` everywhere            | Spinners where the layout is known           | `Skeleton`, `SkeletonRows`          | —                                 | —               |

**Components still needed, each tied to a real repeated pattern:**

- `FilterBar` / `SearchInput`: reservations, front desk, billing, guests.
- `RoomStatusCard`: room board in front desk and housekeeping.
- `Stepper`: booking workflow.
- `ActivityItem` / `Timeline`: guest notes, maintenance activity, audit history.
- `ConfirmDialog` promotion: it exists route-locally in reservations and is needed elsewhere.

**Already covered and not to be duplicated:**

- `PageHeader`
- `Card`
- `Table` (the DataTable role)
- `Badge` / `StatusDot` (the StatusBadge role)
- `StatCard`
- `IconButton`
- `TabList` / `useTabs`
- `Dialog`
- `Drawer`
- `DatePicker`: the native date input via `TextField`
- `WorkspaceSwitcher` (the PropertySwitcher role)
- `StatusPanel` (the Empty, Loading and Error state roles)
- `Avatar` (the GuestAvatar role)
