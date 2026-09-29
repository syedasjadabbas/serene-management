# SERENE design system

> **Direction update (UI/UX overhaul, Nginap-inspired rework):** the values below reflect the current tokens. The visual direction, screen mapping and pattern rationale are in [NGINAP_UI_MAPPING.md](NGINAP_UI_MAPPING.md), which takes precedence where the two differ.

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

- A 32-unit rounded tile in `#15823C`.
- A single-weight white "S" drawn as one stroke, whose diagonal spine is mint `#BFE6CC`: the only accent.
- Flat colours, no gradients or effects.
- Recognizable from 16 px.
- The tile carries its own contrast, so the mark is identical on light and dark backgrounds.
- Brand colours are fixed values, not theme tokens.

**Horizontal lockup (`SereneLogo`).**

- The mark sits beside "SERENE" (700, 0.14em tracking) over "MANAGEMENT" (small, 500, 0.42em tracking, muted).
- Sizes: `sm` (28 px mark), `md` (36 px, sidebar and drawer) and `lg` (44 px, sign-in).
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
| `canvas`                                                                                      | `#f4f5f1` light neutral                   | `#0d1310`                                      | App background behind cards                                       |
| `surface`                                                                                     | `#ffffff`                                 | `#141c18`                                      | Cards, tables, top bar                                            |
| `surface-sunken`                                                                              | `#efece5`                                 | `#0a0f0c`                                      | Table headers, wells, hover                                       |
| `surface-raised`                                                                              | `#ffffff`                                 | `#1a241f`                                      | Dialogs, drawers, popovers                                        |
| `border-subtle` / `border` / `border-strong`                                                  | stone 200 / 300 / 400                     | `#232e29` / `#2f3c36` / `#5a6a62`              | Dividers / quiet outlines / form controls (≥ 3:1)                 |
| `fg` / `fg-secondary` / `fg-muted`                                                            | 16.3 / 7.8 / 5.5 : 1                      | 14.5 / 9.1 / 5.8 : 1                           | Text (ratios measured on `surface`)                               |
| `brand` / `brand-hover` / `brand-subtle` / `brand-fg`                                         | `#15823c` / `#126d33` / `#f0f9f3` / white | `#5fbf95` / `#7ccfa9` / `#15261e` / forest 950 | Primary action, selection, links                                  |
| `accent` / `accent-subtle`                                                                    | brass 700 / 100                           | brass 300 / `#2a2317`                          | VIP, loyalty, wordmark                                            |
| `nav`, `nav-raised`, `nav-active`, `nav-fg`, `nav-fg-muted`, `nav-fg-active`, `nav-indicator` | forest 900 rail                           | `#09110d` rail                                 | Navigation rail and mobile drawer only                            |
| `success` / `warning` / `danger` / `info` (+ `-subtle`)                                       | see §4                                    | lightened for dark                             | Feedback and status                                               |
| `status-*`, `res-*`                                                                           | room and reservation status               | lightened for dark                             | Room Board and reservation screens (used from the module batches) |
| `chart-1…5`, `chart-grid`, `chart-axis`                                                       | forest, brass, blue, sage, terracotta     | lightened                                      | Charts (`components/ui/chart.ts`)                                 |

**Every** text/background pair is at least 4.5:1 in both themes. The lowest is brass on `accent-subtle` at 4.52:1. Graphic marks such as chart lines and control outlines are at least 3:1. When a colour changes, re-check it against `surface`, `canvas`, `surface-sunken` and its own `-subtle` background.

## 3. Typography

The typeface is IBM Plex Sans, with IBM Plex Sans Arabic for Arabic/Urdu script and IBM Plex Mono for codes, confirmation numbers and business dates. The app uses one family in three weights: 400 for text, 500 for labels and emphasis, and 600 for titles. There is no display face. Figures are tabular everywhere.

The scale is fixed in rem, not fluid, with a ratio of about 1.14:

| Utility     | Size        | Role                                                         |
| ----------- | ----------- | ------------------------------------------------------------ |
| `text-2xl`  | 24 px / 600 | Page title (`PageHeader`, one `h1` per page) and key figures |
| `text-xl`   | 20 px / 600 | Legacy page titles until each screen moves to `PageHeader`   |
| `text-lg`   | 16 px / 600 | Card, dialog, drawer and state titles                        |
| `text-base` | 14 px       | Body, descriptions                                           |
| `text-sm`   | 13 px       | Table cells, controls, dense lists                           |
| `text-xs`   | 12 px       | Field labels, secondary cells, badges                        |
| `text-2xs`  | 11 px       | Meta, chart ticks, request references                        |

Prose is capped at 70ch. Headings use `text-wrap: balance`. Do not use uppercase with wide tracking for section labels; the only uppercase is the SERENE wordmark.

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
  - Controls: 36 px (`h-control`), growing to 44 px on coarse pointers.
  - Table rows: 40 px (`h-row`).
  - Small buttons: 28 px.
  - `data-density="touch"` forces 44 px everywhere.
- **Radius.**
  - `rounded-sm`: 4 px, chips inside controls.
  - `rounded-md`: 8 px, buttons, inputs, menus.
  - `rounded-lg`: 12 px, cards, dialogs, table frames.
  - `rounded-full`: badges, filter chips, avatars.
  - Nothing is larger than `rounded-xl` (16 px).
- **Elevation.**
  - `shadow-card`: a 2 px hairline shadow on cards. It is 0 in dark mode, where borders carry the edges.
  - `shadow-raised`: primary buttons and popovers.
  - `shadow-overlay`: dialogs and drawers.
  - Never pair a border with a wide (≥ 16 px) blur on buttons or cards.
- **Layering.** Use named levels only, never ad-hoc z-values:
  1. `--z-sticky` (20): top bar, sticky table headers.
  2. `--z-rail` (30).
  3. `--z-popover` (40): menus.
  4. `--z-skip` (50): skip link.

  Dialogs and drawers use the native top layer.

## 6. Components

| Primitive                     | File                                          | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Button**                    | `Button.tsx`                                  | `primary` once per view or dialog, placed last in the row. `secondary` for alternatives, `ghost` for toolbar and low-emphasis actions, `danger` only for destructive commands, which usually need a dialog confirmation. Sizes `sm` (28), `md` (36) and `touch` (44). `pending` shows a spinner and disables the button. `buttonClass()` styles a `Link` as a button.                                                                                                          |
| **IconButton**                | `IconButton.tsx`                              | Icon-only actions. The `label` is required: it becomes both the accessible name and the tooltip. Sizes are square `md` and `sm` (≥ 24 px).                                                                                                                                                                                                                                                                                                                                     |
| **StatCard**                  | `StatCard.tsx`                                | Compact key figure: tinted icon tile, label, 24 px value, one line of context, optional progress bar, optional link. Four per row on wide screens, two on phones (icon dropped). Never a hero metric.                                                                                                                                                                                                                                                                          |
| **FilterBar / SearchInput**   | `FilterBar.tsx`, `SearchInput.tsx`            | List search form: search field with magnifier, Search, Filters (advanced panel, active count), Clear; optional quick row (ToggleGroup applied at once). Enter submits.                                                                                                                                                                                                                                                                                                         |
| **FactList**                  | `FactList.tsx`                                | Label/value grid for record details (muted 12 px label over 14 px value); `wide` items span the row.                                                                                                                                                                                                                                                                                                                                                                           |
| **Stepper**                   | `Stepper.tsx`                                 | Multi-step workflow progress: numbered circles, done steps ticked, `aria-current="step"`, reachable steps are buttons; phones keep only the current label.                                                                                                                                                                                                                                                                                                                     |
| **DateNavigator**             | `DateNavigator.tsx`                           | Previous day · date · next day · jump to the business date (never the browser date); `min` blocks earlier dates.                                                                                                                                                                                                                                                                                                                                                               |
| **Avatar**                    | `Avatar.tsx`                                  | Initials for people (users, guests); decorative (`aria-hidden`) because the name is always shown. `accent` tone marks VIP guests.                                                                                                                                                                                                                                                                                                                                              |
| **Text link**                 | `textLinkClass` (`Button.tsx`)                | Standalone links ("View all", "Open front desk"): brand, 24 px minimum target, 40 px on touch.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Fields**                    | `TextField`, `Select`, `TextArea`, `field.ts` | Label above the control, hint and error below, wired through `aria-describedby`. The outline is `border-strong` (≥ 3:1) and turns `danger` when invalid. Route-local inputs use `controlClass()`.                                                                                                                                                                                                                                                                              |
| **Dates**                     | `TextField type="date"`                       | Native date input: keyboard entry, the locale's own calendar, and a theme-aware picker (`color-scheme`). Business-date validation stays on the server. Range pickers are built per module on this base.                                                                                                                                                                                                                                                                        |
| **Checkbox / radio**          | native                                        | Brand `accent-color`, label on the right, and a whole-row click target.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **ToggleGroup**               | `ToggleGroup.tsx`                             | Single-choice filter as a segmented control: one bordered group; the selected segment is raised (white, hairline ring). `aria-pressed` buttons, not tabs; scrolls horizontally on narrow screens.                                                                                                                                                                                                                                                                              |
| **Tabs**                      | `tabs.ts` (behaviour), `TabList.tsx` (look)   | Switch views of one subject. Underlined text tabs on a hairline, with a roving tabindex, arrow/Home/End keys, a linked panel, and URL sync where the view is shareable. On narrow screens they scroll instead of wrapping.                                                                                                                                                                                                                                                     |
| **Badge / StatusDot / Count** | `Badge.tsx`                                   | Squared status tag (5 px corners, hairline border in the tone, light tint, 12 px medium), sized for a 40 px row; optional dot. `Count` is the squared numeric tag beside tab and filter labels. `StatusDot` is for legends and dense columns. No rounded pastel pills.                                                                                                                                                                                                         |
| **Alert**                     | `Alert.tsx`                                   | Inline message with an icon. Danger and warning announce immediately (`role="alert"`); info and success use `role="status"`.                                                                                                                                                                                                                                                                                                                                                   |
| **Card**                      | `Card.tsx`                                    | The only surface primitive: white, hairline border, soft shadow, 12 px radius. An optional header (no divider unless `flush`) holds the 16 px title, description and actions. `flush` is for edge-to-edge tables. Never nest cards; use dividers inside.                                                                                                                                                                                                                       |
| **PageHeader**                | `PageHeader.tsx`                              | Breadcrumb trail, the page's `h1` (24 px), a one-line description, meta badges and actions (wrapping). `back` links detail pages to their list.                                                                                                                                                                                                                                                                                                                                |
| **Table**                     | `Table.tsx`                                   | `TableFrame` is a keyboard-focusable scroll region. `Table` requires a caption (visually hidden by default) and takes a `minWidth` below which it scrolls. `THead` is a sunken 36 px header, optionally sticky. `Th`/`Td` use logical alignment, and `numeric` end-aligns with tabular figures. `Tr` has optional `interactive` and `selected` states. `TableEmpty` covers no results. Tables stay tables on phones; they scroll horizontally and are never turned into cards. |
| **Dialog**                    | `Dialog.tsx`                                  | Native `<dialog>`: focus trap, Escape, and focus returned to the opener, including on unmount. Use it for short commands and confirmations. `FormDialog` adds submit on Enter and server-error placement.                                                                                                                                                                                                                                                                      |
| **Drawer**                    | `Drawer.tsx`                                  | Side sheet with the same modal behaviour. `side` is logical (start/end) and mirrors in RTL. Use it for record details that keep the list in view, and for mobile navigation (`tone="nav"`). Closes on backdrop click or Escape.                                                                                                                                                                                                                                                |
| **States**                    | `StatusPanel`, `Skeleton`                     | See §7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Charts**                    | `chart.ts`                                    | Series colours from `CHART_SERIES`, horizontal hairline grid, 11 px muted axes, raised tooltip. Every chart needs a text alternative.                                                                                                                                                                                                                                                                                                                                          |
| **Icons**                     | `lucide-react`                                | 16 px in controls and navigation, 20 px in state panels, stroke inherited. Always `aria-hidden` next to a text label; icon-only controls go through `IconButton`.                                                                                                                                                                                                                                                                                                              |

## 7. Loading, empty and error states

- **Loading.** Use `SkeletonRows` or `Skeleton` where the layout is known (tables, lists, cards), and `StatusPanel kind="loading"` (spinner plus title) only for whole regions whose shape is unknown. Skeletons announce once and shimmer slowly; they are static under reduced motion.
- **Empty.** `StatusPanel kind="empty"`: say what belongs here and how it gets added, not just "No data". A filtered list that finds nothing says so and names the filter.
- **Error.** `StatusPanel kind="error"`: what failed, the request reference for support, and a retry action where retrying makes sense. It is announced with `role="alert"`.
- **Forbidden.** `StatusPanel kind="forbidden"`: name the missing permission. The server still enforces access; the UI only explains.
- **Route level.** `loading.tsx` and `error.tsx` use `level={1}`, so the panel becomes the page's `h1`.

## 8. Responsive behaviour

| Width         | Frame                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| < 640 (`sm`)  | Top bar: menu, workspace switcher (truncates), business date (compact), avatar only. The navigation drawer opens from the start edge and closes when a link is followed. The page header stacks, and actions wrap. |
| 640–1023      | Same frame. The user name is shown. Cards flow into 2 columns where the page allows.                                                                                                                               |
| ≥ 1024 (`lg`) | A fixed 240 px pale mint rail holds the grouped navigation (solid green active pill), next to a sticky 64 px top bar (switcher · reservation search from `xl` · business date · account) and the content.          |
| ≥ 1600        | Content is capped at 1600 px and centred.                                                                                                                                                                          |

- **Tables** keep their columns and scroll inside `TableFrame`, whose `minWidth` is set per table.
- **Touch** (coarse pointer): controls grow to 44 px, and chips, tabs and nav items grow to 44 px.
- **Horizontal overflow** of the page itself is a defect at 375, 768, 1024 and 1440 px.

## 9. Accessibility (WCAG 2.2 AA)

- **Contrast.** Text is at least 4.5:1 and UI outlines at least 3:1 (§2).
- **Focus.** A 2 px `--sm-focus` ring with 2 px offset; it is the same blue on the light rail (5.1:1).
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
