# SERENE design system

> **Direction (September 2026): the SERENE product family.** SERENE MANAGEMENT now shares one design language with SALESTORM, the company's CRM: same typeface (Geist), neutral canvas, white bordered surfaces, deep Serene green `#107c41`, uppercase tracked micro-labels, surface page headers and solid-green active navigation. The products stay distinct in content: SALESTORM is about leads and pipelines, SERENE MANAGEMENT about stays, rooms and money. This document is the source of truth; [NGINAP_UI_MAPPING.md](NGINAP_UI_MAPPING.md) remains as secondary reference for how hospitality information is organised, not for the visual style.

## 0. Family language (shared with SALESTORM)

Measured from the live SALESTORM CSS and screens:

| Element       | Family rule                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typeface      | Geist (UI), Geist Mono (codes, dates, confirmation numbers). IBM Plex Sans Arabic covers Arabic/Urdu script.                                                                 |
| Brand green   | `#107c41`, hover `#0a5d2b`, soft `#eef7f1`. Primary actions, the active page, selection, positive states. Never decoration.                                                  |
| Neutrals      | Zinc-like greys with a hair of green: canvas `#f7f8f7`, surface white, sunken `#f3f4f3`, text `#18181b`.                                                                     |
| Surfaces      | White, hairline border, near-zero shadow, 16 px radius; page and record headers 20 px.                                                                                       |
| Controls      | 38 px high, 10 px radius, white with a border; the primary button is solid green, semibold.                                                                                  |
| Micro-labels  | `label-caps`: 11 px, 600, 0.1em tracking, uppercase, muted. Menu headings, fact labels, table headings, selector labels.                                                     |
| Status pills  | Rounded-full, uppercase 11 px semibold, tinted in the semantic tone.                                                                                                         |
| Navigation    | Top navigation, no sidebar: a row of domains under the header (direct links for daily destinations, small menus per domain); the current page is a mint pill in brand green. |
| Top bar       | Bordered 40 px controls: property selector with a `PROPERTY` label, search, business date with `BUSINESS DATE`, the account chip.                                            |
| Page header   | A white surface: mint icon tile, breadcrumb, bold 24 px title, one-line description, actions on the end.                                                                     |
| Record header | The same surface with an eyebrow (record type), status pills beside the name, and key facts (`KeyFacts`) under a hairline.                                                   |

UI/UX overhaul, Batch 0: the visual foundation every PMS screen uses. Tokens live in `app/globals.css`, primitives in `components/ui/`, the application frame in `components/workspace/AppShell.tsx`. A living catalogue of every primitive and state is served in development at `/design-system` (not in production builds).

**Character.** Premium hospitality on an operational tool. A front-desk agent reads this screen between guests for eight hours in a bright lobby, and the night auditor reads it at 2 a.m. in a dim back office. So the design has:

- a light theme by default and a first-class dark theme;
- quiet surfaces, so the data reads first;
- colour reserved for state and action;
- one brand colour and one restrained accent.

The design is original to SERENE. Reference boards inspired its mood only, not its layouts or assets.

---

## 1. Audit of the pre-overhaul UI (September 2026)

The audit covered 152 `.tsx` files under `app/` (excluding `app/api`) and `components/`. Counts come from class strings.

| Area               | Finding                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tokens             | Fully tokenised. The code has no hex colours, no raw Tailwind palette colours and no inline styles, so a token-level re-theme reaches every screen.                                                                                                                |
| Primitives in use  | `Button` (197 uses), `TextField` (168), `StatusPanel` (165), `Badge` (101), `Select` (96), `Alert` (52), `TextArea` (52), `FormDialog` (44), `Dialog` (18).                                                                                                        |
| Missing primitives | Card, Table, PageHeader, Drawer, IconButton, Skeleton, filter chips and visual tabs, plus an icon set (no icon library was installed; `lucide-react` was added in this batch).                                                                                     |
| Cards              | 89 hand-rolled surfaces: 6 variants of `rounded-lg/md border border-border-subtle bg-surface`, with padding split across p-3, p-4 and p-6.                                                                                                                         |
| Tables             | 22 tables with no primitive and 6 `<thead>` variants. The most common header cell class strings were `py-2 pr-3`, `px-2 py-2` and `px-3 py-2`. Physical and logical alignment were mixed (57 `pr-3` and 35 `text-left` against 20 `pe-3`), which is an RTL defect. |
| Typography         | h1 was split across `text-xl` (20 pages) and `text-lg` (10 pages, mostly detail views). Section titles came in 3 sizes: `text-sm`, `text-lg`, and unsized `font-semibold`. The page-title size (18 px) was too small for the page hierarchy.                       |
| Filters            | Three filter groups (front desk, groups, billing) used three different styles.                                                                                                                                                                                     |
| Shell              | A single top bar held 12 navigation items. Below `lg` the navigation moved to a horizontally scrolling row, and there was no mobile menu.                                                                                                                          |
| Icons              | Text glyphs only (▾, ×, ←).                                                                                                                                                                                                                                        |
| Charts             | One Recharts line chart, coloured `currentColor`, with default grid and tooltip.                                                                                                                                                                                   |
| Dates              | 41 date inputs, all native `type="date"` through `TextField`.                                                                                                                                                                                                      |
| Elevation          | `shadow-raised` was used twice and `shadow-overlay` twice. Otherwise surfaces were flat.                                                                                                                                                                           |

## Brand

`components/brand/Logo.tsx` holds the SERENE MANAGEMENT brand; `app/icon.svg` is the favicon.

**Mark (`SereneMark`).**

- A 32-unit rounded tile in `#107C41` (the family green).
- A single-weight white "S" drawn as one stroke, whose diagonal spine is mint `#BFE6CC`: the only accent.
- Flat colours, no gradients or effects.
- Recognizable from 16 px.
- The tile carries its own contrast, so the mark is identical on light and dark backgrounds.
- Brand colours are fixed values, not theme tokens.

**Horizontal lockup (`SereneLogo`).**

- The mark sits beside "SERENE" (700, 0.14em tracking) over "MANAGEMENT" (small, 500, 0.42em tracking, muted).
- Sizes: `sm` (28 px mark), `md` (36 px, drawer) and `lg` (44 px, sign-in).
- `tone="inverse"` is for dark backgrounds.
- Its visible text is its accessible name.
- Do not recolour, stretch, add effects or add text to either element.

## 2. Tokens

There are three layers; components only ever use the last one.

1. **Palette** (`--palette-*`): three ramps.
   - **stone:** warm neutrals, with green in the darkest steps.
   - **forest:** the brand.
   - **brass:** the accent.
2. **Semantic** (`--sm-*`): meaning, redefined for dark mode and density.
3. **Tailwind** (`@theme inline`): utilities such as `bg-surface`, `text-fg-muted`, `bg-nav` and `shadow-card`.

| Token (utility)                                                                               | Light                                     | Dark                                           | Use                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `canvas`                                                                                      | `#f7f8f7` neutral near-white              | `#0d1310`                                      | App background behind cards                                       |
| `surface`                                                                                     | `#ffffff`                                 | `#141c18`                                      | Cards, tables, header, navigation                                 |
| `surface-sunken`                                                                              | `#f3f4f3`                                 | `#0a0f0c`                                      | Table headers, wells, fact tiles, hover                           |
| `surface-raised`                                                                              | `#ffffff`                                 | `#1a241f`                                      | Dialogs, drawers, popovers                                        |
| `border-subtle` / `border` / `border-strong`                                                  | `#e8e9e7` / `#dcdedb` / `#8e928f`         | `#232e29` / `#2f3c36` / `#5a6a62`              | Dividers / quiet outlines / form controls (≥ 3:1)                 |
| `fg` / `fg-secondary` / `fg-muted`                                                            | 16.3 / 7.8 / 5.5 : 1                      | 14.5 / 9.1 / 5.8 : 1                           | Text (ratios measured on `surface`)                               |
| `brand` / `brand-hover` / `brand-subtle` / `brand-fg`                                         | `#107c41` / `#0a5d2b` / `#eef7f1` / white | `#5fbf95` / `#7ccfa9` / `#15261e` / forest 950 | Primary action, selection, links                                  |
| `accent` / `accent-subtle`                                                                    | brass 700 / 100                           | brass 300 / `#2a2317`                          | VIP, loyalty, wordmark                                            |
| `nav`, `nav-raised`, `nav-active`, `nav-fg`, `nav-fg-muted`, `nav-fg-active`, `nav-indicator` | white, `#107c41` active item              | `#0f1512`                                      | Navigation menus and the mobile drawer                            |
| `success` / `warning` / `danger` / `info` (+ `-subtle`)                                       | see §4                                    | lightened for dark                             | Feedback and status                                               |
| `status-*`, `res-*`                                                                           | room and reservation status               | lightened for dark                             | Room Board and reservation screens (used from the module batches) |
| `chart-1…5`, `chart-grid`, `chart-axis`                                                       | forest, brass, blue, sage, terracotta     | lightened                                      | Charts (`components/ui/chart.ts`)                                 |

**Every** text/background pair is at least 4.5:1 in both themes. The lowest is brass on `accent-subtle` at 4.52:1. Graphic marks such as chart lines and control outlines are at least 3:1. When a colour changes, re-check it against `surface`, `canvas`, `surface-sunken` and its own `-subtle` background.

## 3. Typography

The typeface is Geist (shared with SALESTORM), with IBM Plex Sans Arabic for Arabic/Urdu script and Geist Mono for codes, confirmation numbers and business dates. One family in four weights: 400 for text, 500 for labels and controls, 600 for section titles, pills and the primary button, 700 for page titles and key figures (with -0.02em tracking). There is no display face. Figures are tabular everywhere.

The scale is fixed in rem, not fluid, with a ratio of about 1.14:

| Utility     | Size        | Role                                                         |
| ----------- | ----------- | ------------------------------------------------------------ |
| `text-2xl`  | 24 px / 700 | Page title (`PageHeader`, one `h1` per page) and key figures |
| `text-xl`   | 20 px / 600 | Large figures inside cards                                   |
| `text-lg`   | 16 px / 600 | Card, dialog, drawer and state titles                        |
| `text-base` | 14 px       | Body, descriptions                                           |
| `text-sm`   | 13 px       | Table cells, controls, dense lists                           |
| `text-xs`   | 12 px       | Field labels, secondary cells, badges                        |
| `text-2xs`  | 11 px       | Meta, chart ticks, request references                        |

Prose is capped at 70ch. Headings use `text-wrap: balance`. Uppercase appears only through `label-caps` (micro-labels, table headings), status pills and the SERENE wordmark; never for headings or body text.

## 4. Colour and status semantics

| Meaning                       | Tone      | Examples                                     |
| ----------------------------- | --------- | -------------------------------------------- |
| Done, available, clean        | `success` | Vacant clean, paid, checked in               |
| Needs attention soon          | `warning` | Due out, deposit due, audit due              |
| Blocked, overdue, destructive | `danger`  | Out of order, cancelled, audit overdue, void |
| Scheduled, in progress        | `info`    | Arriving, inspecting, occupied               |
| The product's own state       | `brand`   | Confirmed, selected                          |
| Recognition                   | `accent`  | VIP, loyalty tier                            |
| No emphasis                   | `neutral` | Draft, closed, out of service                |

Status is never shown by colour alone: every badge, dot and cell carries a text label or code. Brand colour marks primary actions, current selection and focus-adjacent state; it is not used for decoration. Brass appears in at most one or two places per screen.

## 5. Spacing, radius, elevation, layering

- **Spacing** is a 4 px grid.
  - Inside a card: `p-4`.
  - Between stacked cards: `gap-4`, or `gap-6` between page sections.
  - Page gutters: `px-4` on mobile, `px-6` on tablet, `px-8` on desktop.
  - Content caps at 1600 px.
- **Density.**
  - Controls: 38 px (`h-control`), growing to 44 px on coarse pointers; top-bar controls are 40 px.
  - Table rows: 44 px (`h-row`).
  - Small buttons: 28 px.
  - `data-density="touch"` forces 44 px everywhere.
- **Radius.**
  - `rounded-sm`: 6 px, chips inside controls.
  - `rounded-md`: 10 px, buttons, inputs, menus, navigation items, icon tiles, avatars.
  - `rounded-lg`: 16 px, cards, dialogs, table frames, tab bars.
  - `rounded-xl`: 20 px, page and record header surfaces only.
  - `rounded-full`: status pills, counts.
- **Elevation.**
  - `shadow-card`: a barely visible 2 px shadow on cards and bordered controls; the border carries the edge. It is 0 in dark mode.
  - `shadow-raised`: the selected segment of a toggle group.
  - `shadow-overlay`: dialogs and drawers.
  - Never pair a border with a wide (≥ 16 px) blur on buttons or cards.
- **Layering.** Use named levels only, never ad-hoc z-values:
  1. `--z-sticky` (20): top bar, sticky table headers.
  2. `--z-popover` (40): menus, navigation menus.
  3. `--z-skip` (50): skip link, navigation progress bar.

  Dialogs and drawers use the native top layer.

## 6. Components

| Primitive                     | File                                          | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**                    | `Button.tsx`                                  | `primary` once per view or dialog, placed last in the row. `secondary` for alternatives, `ghost` for toolbar and low-emphasis actions, `danger` only for destructive commands, which usually need a dialog confirmation. Primary is solid green and semibold; secondary is white with a border. Sizes `sm` (28), `md` (38) and `touch` (44). `pending` shows a spinner and disables the button. `buttonClass()` styles a `Link` as a button.                                                                                                                                                                |
| **IconButton**                | `IconButton.tsx`                              | Icon-only actions. The `label` is required: it becomes both the accessible name and the tooltip. Sizes are square `md` and `sm` (≥ 24 px).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **StatCard**                  | `StatCard.tsx`                                | Compact key figure: tinted icon tile, label, 24 px value, one line of context, optional progress bar, optional link. Four per row on wide screens, two on phones (icon dropped). Never a hero metric.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **FilterBar / SearchInput**   | `FilterBar.tsx`, `SearchInput.tsx`            | List search form: search field with magnifier, Search, Filters (advanced panel, active count), Clear; optional quick row (ToggleGroup applied at once). Enter submits.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **FactList**                  | `FactList.tsx`                                | Label/value grid for record details (`label-caps` over a 14 px medium value); `wide` items span the row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Stepper**                   | `Stepper.tsx`                                 | Multi-step workflow progress: numbered circles, done steps ticked, `aria-current="step"`, reachable steps are buttons; phones keep only the current label.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **DateNavigator**             | `DateNavigator.tsx`                           | Previous day · date · next day · jump to the business date (never the browser date); `min` blocks earlier dates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Avatar**                    | `Avatar.tsx`                                  | Rounded square. Initials for people; decorative (`aria-hidden`) because the name is always shown. Guests use the mint tile, `solid` (green, white initials) is the signed-in user, `accent` marks VIP guests.                                                                                                                                                                                                                                                                                                                                                                                               |
| **Text link**                 | `textLinkClass` (`Button.tsx`)                | Standalone links ("View all", "Open front desk"): brand, 24 px minimum target, 40 px on touch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Fields**                    | `TextField`, `Select`, `TextArea`, `field.ts` | Label above the control, hint and error below, wired through `aria-describedby`. The outline is `border-strong` (≥ 3:1) and turns `danger` when invalid. Route-local inputs use `controlClass()`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Dates**                     | `TextField type="date"`                       | Native date input: keyboard entry, the locale's own calendar, and a theme-aware picker (`color-scheme`). Business-date validation stays on the server. Range pickers are built per module on this base.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Checkbox / radio**          | native                                        | Brand `accent-color`, label on the right, and a whole-row click target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **ToggleGroup**               | `ToggleGroup.tsx`                             | Single-choice filter as a segmented control: one bordered group; the selected segment is raised (white, hairline ring). `aria-pressed` buttons, not tabs; scrolls by touch on phones (no scrollbar), wraps from `md`.                                                                                                                                                                                                                                                                                                                                                                                       |
| **Tabs**                      | `tabs.ts` (behaviour), `TabList.tsx` (look)   | Switch views of one subject. A white bordered bar of text tabs (as in SALESTORM); the selected tab is a mint pill in brand green. Roving tabindex, arrow/Home/End keys, a linked panel, URL sync where the view is shareable. On narrow screens the bar scrolls instead of wrapping.                                                                                                                                                                                                                                                                                                                        |
| **Badge / StatusDot / Count** | `Badge.tsx`                                   | Status pill: rounded-full, uppercase 11 px semibold with 0.06em tracking, hairline border in the tone, light tint; optional dot. `Count` is the round numeric tag beside tab and filter labels. `StatusDot` is for legends and dense columns. Metadata that is not a status stays plain text.                                                                                                                                                                                                                                                                                                               |
| **Alert**                     | `Alert.tsx`                                   | Inline message with an icon. Danger and warning announce immediately (`role="alert"`); info and success use `role="status"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Card**                      | `Card.tsx`                                    | The only surface primitive: white, hairline border, near-zero shadow, 16 px radius, 20–24 px padding. An optional header (no divider unless `flush`) holds the 16 px title, description and actions. `flush` is for edge-to-edge tables. Never nest cards; use dividers inside.                                                                                                                                                                                                                                                                                                                             |
| **PageHeader**                | `PageHeader.tsx`                              | A white header surface (20 px radius): optional mint `icon` tile, breadcrumb trail (or `back` on record pages), optional `eyebrow` (record type), the page's `h1` (24 px bold), one-line description, `meta` pills, actions (primary last, wrapping), and an optional `footer` under a hairline for key facts or identifier chips. No outer margin: pages stack sections with `gap-6`.                                                                                                                                                                                                                      |
| **KeyFacts / IdChip**         | `KeyFacts.tsx`                                | `KeyFacts`: 2–4 quiet sunken tiles (micro-label over a semibold value, optional hint) for the facts staff check first on a record. `IdChip`: bordered chip with a micro-label and a monospace identifier.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Table**                     | `Table.tsx`                                   | `TableFrame` is a keyboard-focusable scroll region. `Table` requires a caption (visually hidden by default) and takes a `minWidth` below which it scrolls. `THead` is a sunken 40 px header in micro-labels (every `thead th` in the app gets this style from the base layer), optionally sticky; the first and last cells get 16 px insets. `Th`/`Td` use logical alignment, and `numeric` end-aligns with tabular figures. `Tr` has optional `interactive` and `selected` states. `TableEmpty` covers no results. Tables stay tables on phones; they scroll horizontally and are never turned into cards. |
| **Dialog**                    | `Dialog.tsx`                                  | Native `<dialog>`: focus trap, Escape, and focus returned to the opener, including on unmount. Use it for short commands and confirmations. `FormDialog` adds submit on Enter and server-error placement.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Drawer**                    | `Drawer.tsx`                                  | Side sheet with the same modal behaviour. `side` is logical (start/end) and mirrors in RTL. Use it for record details that keep the list in view, and for mobile navigation (`tone="nav"`). Closes on backdrop click or Escape.                                                                                                                                                                                                                                                                                                                                                                             |
| **States**                    | `StatusPanel`, `Skeleton`                     | See §7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Charts**                    | `chart.ts`                                    | Series colours from `CHART_SERIES`, horizontal hairline grid, 11 px muted axes, raised tooltip. Every chart needs a text alternative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Icons**                     | `lucide-react`                                | 16 px in controls and navigation, 20 px in state panels, stroke inherited. Always `aria-hidden` next to a text label; icon-only controls go through `IconButton`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 6a. Top navigation

The application has no sidebar. `AppShell` (components/workspace) is a sticky header plus a navigation row; below `lg` the row moves into a drawer.

- **Model.** `components/workspace/nav.ts` (`NavEntry`: link or group of links). The property workspace's domains, labels, tab destinations and permissions live in one table, `PROPERTY_NAV` in `sections.ts`; `WorkspaceNav` filters it with `usePermissions` (UI gating only, the server enforces) and drops groups left empty. Organization sections come from `ORGANIZATION_SECTIONS`.
- **Domains (property).** Dashboard · Front office (Front desk, Reservations, Availability) · Guests (Guests, Companies, Groups, Loyalty) · Rooms (Housekeeping, Maintenance) · Revenue & finance (Rates, Packages, Billing) · Night audit · Reports · More (the organization workspace, for users who may use it). Companies and Loyalty are tabs of Guests, Packages a tab of Rates; there is no separate cashiering page (cashier actions live in the folio).
- **Active state.** An item is current on its route, nested record routes (`/reservations/[id]`) and, for tab items, its `?tab=`; the default tab (Guests, Rates) also covers record pages. The domain holding the current page is a mint pill; inside the menu the item is marked `aria-current="page"`.
- **Menus (`NavMenu`).** A disclosure button (`aria-expanded`, `aria-controls`) opening a 320 px white panel of links with icon tiles and one-line descriptions; not an ARIA menu, so links stay links. Click, Enter or Space opens it (never hover only); ArrowDown opens and focuses the first link; arrows, Home and End move; Escape closes and returns focus; leaving it by focus or pointer closes it, and so does following a link. 150 ms fade and slide, none under reduced motion. Menus in the second half of the row open towards the end.
- **Mobile (`MobileNav`).** Below `lg` the menu button opens the drawer: the same entries as expandable groups (the one holding the current page starts open), 44 px rows, and on phones the account entries. The header keeps menu · mark · property code · search · business date.

## 6b. Dropdowns and global search (one interaction system)

- **Core (`components/ui/listbox.tsx`).** Option rows (icon tile, highlighted label, description, trailing note, check when selected; 40 px, 44 px on touch), uppercase group headings, `highlight()` for matched text, `useActiveOption` (ArrowUp/Down wrap and skip disabled options, Home/End, Enter) and `useAnchoredPopover`, which puts the panel in the browser's top layer (Popover API) below or above its control, clamped to the viewport: never clipped by scrolling containers, never hidden behind an open dialog.
- **SearchableSelect.** The only dropdown. A `role="combobox"` button opens a listbox; a search field appears on lists longer than 7 items and for async sources. Clearable, groups, loading, empty, error and disabled states. Keys: Enter/Space/ArrowDown open, typing on the closed button starts a search, arrows/Home/End move, Enter chooses, Escape closes without closing a surrounding dialog, Tab leaves; focus returns to the button. `Select` is the same component behind the `options / value / onChange(e)` API, so every form and filter uses it; native `<select>` is not used. Short lists (2–5 choices) that filter a view stay `ToggleGroup`.
- **Entity pickers.** `GuestPicker` (components/guests) and `CompanyPicker` (components/accounts) are SearchableSelect over the existing debounced server searches; `availableRoomOptions` (components/rooms) formats free rooms (Room 204, status line, grouped by floor) for every room dropdown. The property switcher gains a search field once a user has more than six workspaces.
- **Global search (`GlobalSearch`, Ctrl/Cmd+K).** A search button in the header (a field from `xl`, an icon below) opens a command palette (native modal dialog; full screen on phones). It searches only record types the user may read in the current property: reservations, guests, rooms, folios, companies, groups, maintenance requests and rate plans; in the organization workspace, guests and companies. Results are grouped by type with the match highlighted and open the existing record route (a room opens the room board with the room selected, `?room=`). No new endpoint: `lib/api/endpoints/search.api.ts` fans out to the existing list endpoints that already search with `q` and enforce permissions and property scope; rooms and rate plans are filtered from their cached lists. Recent searches are kept in this browser only.

## 6c. Filters, search, sort and pagination

Every list filter is applied by the server (property-scoped query, permission-checked route); the UI never filters a partial page locally, except the small per-property lists the global search filters (rooms, rate plans).

- **State.** Filters that define what a page shows live in the URL (reservations, front desk, housekeeping incl. `floor`/`roomType`, maintenance, billing, groups `status`, reports); changing one keeps the others, a status change keeps the room board's floor and type, switching views resets view-specific filters. Draft forms (reservation advanced filters, audit trail, reports) apply on Search/Apply/Run.
- **Pagination.** Cursor lists render one query per page keyed by the filter key and the cursor, so a filter or sort change starts again at page one and a late response can never mix pages of two filters. Lists render RTK `currentData` (the current arguments only); `isFetching && !currentData` shows the region's loading state instead of the previous rows.
- **Validation.** Date ranges are checked on the client (From ≤ To, min/max on the inputs) and on the server; search boxes stop at 100 characters and explain the 2-character minimum; unknown or malformed URL values fall back to the default instead of producing an error.
- **Empty states.** "None yet" (no filter) and "No … match these filters" (+ Clear filters) are always distinct.
- **Counts.** Tab and header counts are intentionally global for the business date (front desk tabs, housekeeping views, maintenance views): they do not follow the list's search or priority filter. The room board line shows matches of the current status filter out of the rooms of the chosen floor and room type.
- **Confirmation search.** Front desk, billing and the reservation list match a confirmation number typed in any case, as digits only, or with a share suffix (`confirmationMatchSql` / `confirmationSearch`).

## 7. Loading, empty and error states

- **Loading.** Use `SkeletonRows` or `Skeleton` where the layout is known (tables, lists, cards), and `StatusPanel kind="loading"` (spinner plus title) only for whole regions whose shape is unknown. Skeletons announce once and shimmer slowly; they are static under reduced motion.
- **Empty.** `StatusPanel kind="empty"`: say what belongs here and how it gets added, not just "No data". A filtered list that finds nothing says so and names the filter.
- **Error.** `StatusPanel kind="error"`: what failed, the request reference for support, and a retry action where retrying makes sense. It is announced with `role="alert"`.
- **Forbidden.** `StatusPanel kind="forbidden"`: name the missing permission. The server still enforces access; the UI only explains.
- **Page loading.** A page that is waiting for its data or permissions renders `PageSkeleton` (header, filter strip and rows, or `layout="detail"`) inside the app shell, never a blank full-page loader; the skeleton carries the page's `h1` while it loads. A page that already knows its heading keeps it and skeletons only the body (night audit).
- **Route level.** Workspace `loading.tsx` files and page Suspense fallbacks use `PageSkeleton`; `error.tsx` uses `StatusPanel level={1}`, so the panel becomes the page's `h1`. The branded full-screen loader is kept for session restore and the first workspace load, before the shell exists.
- **Navigation.** Following a link to another page shows a 2 px brand-green bar along the top edge until the new page renders (`NavigationProgress`). Next's dev "Rendering…" indicator is turned off. New pages open at the top; browser back and forward restore the previous position.

## 8. Responsive behaviour

| Width         | Frame                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| < 640 (`sm`)  | Top bar: menu, workspace switcher (truncates), business date (compact), avatar only. The navigation drawer opens from the start edge and closes when a link is followed. The page header stacks, and actions wrap.                                                                                                                                |
| 640–1023      | Same frame. The user name is shown. Cards flow into 2 columns where the page allows.                                                                                                                                                                                                                                                              |
| ≥ 1024 (`lg`) | Sticky header: logo · property selector · reservation search (a field from `xl`, an icon below) · business date and audit state · account; under it a 48 px navigation row (Dashboard, Front office ▾, Guests ▾, Rooms ▾, Revenue & finance ▾, Night audit, Reports, More ▾). The `BUSINESS DATE` label and the account name appear from 1400 px. |
| ≥ 1600        | Content is capped at 1600 px and centred.                                                                                                                                                                                                                                                                                                         |

- **Tables** keep their columns and scroll inside `TableFrame`, whose `minWidth` is set per table. Dense operational tables (front desk) pin their identifying first column while scrolling.
- **Segmented filters** (`ToggleGroup`) scroll by touch on phones with no visible scrollbar and wrap onto more rows from `md`.
- **Touch** (coarse pointer): controls grow to 44 px, and chips, tabs and nav items grow to 44 px.
- **Horizontal overflow** of the page itself is a defect at 375, 768, 1024 and 1440 px.

## 9. Accessibility (WCAG 2.2 AA)

- **Contrast.** Text is at least 4.5:1 and UI outlines at least 3:1 (§2).
- **Focus.** A 2 px `--sm-focus` ring with 2 px offset; it is brand green on every surface (5.3:1 on white).
- **Keyboard and structure.**
  - Skip link to `#main`.
  - One `h1` per page.
  - Landmarks: navigation, banner, main.
  - Tabs follow the ARIA pattern; filters are `aria-pressed` groups.
  - Dialogs and drawers trap focus and return it on close.
  - Scrollable table regions are focusable and labelled.
  - Every table has a caption and `scope` headers.
- **Target size.** At least 24 px everywhere, and 44 px on touch.
- **Announcements.** Errors and denials use `role="alert"`; loading uses `role="status"`.
- **Motion.** Transitions are 150–200 ms with an ease-out-quart curve and only convey state: hover, a dialog or drawer entering, the skeleton shimmer. `prefers-reduced-motion` removes them.
- **Direction.** Logical properties only (`ms`, `pe`, `start`, `text-start`). Chevrons mirror in RTL.
- **Lint.** `eslint-plugin-jsx-a11y` recommended rules run in `npm run lint`.

## 10. Dark mode

The product is **light by default and does not follow the operating system**: a dark OS setting must not turn the PMS dark (visual correction, see NGINAP_UI_MAPPING.md §4).

A complete dark palette remains available as an explicit opt-in (`data-theme="dark"` on `<html>`, used today by the `/design-system` catalogue). It follows the same rules:

- green-black surfaces;
- brand and status colours lightened to at least 4.5:1;
- the primary button inverted (light green fill, dark text);
- native controls following via `color-scheme`.

## 11. Migration backlog for the module batches

Batch 0 changed tokens, primitives and the frame, which restyled every screen without touching page logic. The only page edits were adopting the shared tabs (Guests, Rates), the filter chips (front desk, groups, billing) and the chart tokens (dashboard). The per-module batches will:

1. Replace hand-rolled page titles with `PageHeader`, which aligns every h1 to 24 px.
2. Replace the 89 hand-rolled card surfaces with `Card`.
3. Move the 22 tables to `Table`. This fixes the physical `pr-3`/`text-left` alignment and adds sticky headers and skeleton loading.
4. Replace glyph icons (←, ×) with lucide icons through `IconButton`/`PageHeader`.
5. Build module-specific views on these primitives:
   - the Room Board with `status-*` tokens;
   - dashboard key figures;
   - folio windows.
