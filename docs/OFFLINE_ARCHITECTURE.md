# Offline operations architecture

Status: **spike, phase 1 of 4 delivered (read-only offline)**. This document is the contract
for offline support in SERENE MANAGEMENT: what works without a connection, what never will,
how data is stored and protected on the device, and how later phases add offline actions
without weakening the server's authority. Decision D57 in `docs/ARCHITECTURE.md` §15.

The server stays the only source of truth. Offline mode is a safety net for connection
outages at the front desk, not a second system of record.

> **Release scope: OFFLINE READ-ONLY support.**
>
> The current release lets staff **view** the last synced front-office snapshot (arrivals,
> in-house guests, departures, rooms) of a property when the connection drops. It does
> **not** provide offline transactional PMS operations: no check-in, check-out, room
> assignment, housekeeping status change, reservation change, payment, charge or any other
> write can be made or queued offline. Every change still requires a live connection to the
> server. The queue types and conflict rules below are a design contract for later phases,
> not a shipped feature.
>
> Offline support is active in **production builds only** (`next build` + `next start`). The
> service worker is not registered under `next dev`, and a worker registered earlier in a
> development browser is removed on the next dev page load.

---

## A. Readiness assessment

| Area                             | Before this spike                                                                                                                                              | Consequence for offline                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client persistence               | None. RTK Query keeps server data in memory only (30 s `keepUnusedDataFor`); `localStorage` holds a few UI prefs.                                              | Nothing survives a reload; a reload without network showed the browser's error page.                                                                                                        |
| Service worker, manifest, public | None (no `public/` folder).                                                                                                                                    | No app shell available offline.                                                                                                                                                             |
| Authentication                   | HttpOnly cookies (access 15 min, refresh longer); the browser never sees a token.                                                                              | Good for offline safety: nothing secret can be stored client-side. A queue can only sync under a live session.                                                                              |
| Property scope                   | Always in the URL path and `ctx.propertyId`; every API call is property-scoped.                                                                                | Offline data can be keyed and isolated by property the same way.                                                                                                                            |
| Optimistic concurrency           | Check-in, assign room, room move, check-out, extend and housekeeping status commands all carry an entity `version`; stale versions return 409 `STALE_VERSION`. | Conflict detection for replayed commands already exists server-side.                                                                                                                        |
| Idempotency                      | `Idempotency-Key` only for financial commands and night audit. **Not** for check-in, check-out, assign, housekeeping.                                          | A replayed front-desk command after a lost response is detected by version/state errors, not recognised as a duplicate. Server idempotency for these commands is a prerequisite of phase 3. |
| Business date                    | Server-owned (`useBusinessDate`), never the browser clock.                                                                                                     | A snapshot must carry its business date; night audit makes it stale.                                                                                                                        |
| CSP                              | Nonce + `'strict-dynamic'`, `default-src 'self'`, no `'unsafe-eval'` in production.                                                                            | Verified: same-origin service worker registration works under the production CSP unchanged.                                                                                                 |
| Proxy (`proxy.ts`)               | Redirected every non-API path without a session to `/login`.                                                                                                   | `/sw.js`, `/manifest.webmanifest`, `/icon.svg` had to be excluded and `/offline` made public.                                                                                               |

Verdict: the architecture is well suited to **read-only offline** now. **Offline writes** are
feasible for a small set of front-desk commands because version-based conflict detection
exists, but they need server-side idempotency for those commands before they are safe
(phase 3).

## B. Architecture

```
Browser                                                            Server
┌──────────────────────────────────────────────────────────┐
│ Service worker (public/sw.js)                            │
│  • navigations: network first → cached /offline shell    │
│  • /_next/static, icon, manifest: network first → cache  │
│  • /api/*, pages' HTML, RSC, /_next/image: never cached  │
├──────────────────────────────────────────────────────────┤
│ App (online)                          ──── HTTPS ──────► │ Route handlers, services,
│  RTK Query (memory) ── OfflineSnapshotRecorder ──┐       │ RBAC, business rules
│  ConnectivityStatus (probe /api/health/live)     │       │ (unchanged)
├──────────────────────────────────────────────────┼───────┤
│ IndexedDB "serene-offline" (lib/offline/db.ts)   ▼       │
│  meta: session owner   snapshots: user×property  queue   │
├──────────────────────────────────────────────────────────┤
│ /offline shell (app/(offline)/offline): read-only view   │
└──────────────────────────────────────────────────────────┘
```

- **Cache Storage** holds only public, user-independent resources: the `/offline` shell
  (fetched with `credentials: "omit"`, so it can never contain user data) and static assets.
- **IndexedDB** holds the only private data: minimised snapshots written by the app itself.
- **Online/offline model**: the browser's `offline` event is trusted immediately; "online" is
  confirmed by probing `/api/health/live` (no DB, no session), because `navigator.onLine` is
  true on a LAN whose internet link is down. Probes: every 60 s online, 15 s offline, and
  1 s / 3 s / 6 s after an `online` event; only while the tab is visible.
- **Pure rules** live in `lib/offline/policy.ts` (unit-tested): keys, minimisation, expiry,
  reconciliation, sync outcome classification.

## C. MVP scope

Phase 1 (this spike, delivered — **read-only**; no offline writes of any kind):

- App shell and static assets cached by a service worker; offline navigation lands on the
  `/offline` shell instead of the browser error page.
- Read-only offline view of the last snapshot: arrivals, in-house, departures, rooms, with
  search, per property, never mixed.
- Connectivity indicator in the property workspace header.
- Snapshot lifecycle: user × property keys, minimisation, 24 h expiry, reconciliation with the
  live session, wiping on sign-out, login, user change and on demand.
- Queue **schema and contract** (types, store, outcome classification) — nothing enqueues yet.

Phase 2+ (see §Q): offline actions for assign room, check-in, check-out and housekeeping
status, behind server idempotency.

## D. Readable entities (offline snapshot)

One snapshot per **user × property** (`snapshotKey = userId:propertyId`), refreshed on
workspace open (if older than 1 min), every 10 min while the tab is visible and online, and
when the tab becomes visible or the connection returns.

| Section    | Source (existing API, unchanged)           | Needs            | Stored fields (minimised)                                                                                                         |
| ---------- | ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Header     | `/front-desk/summary`, room board          | —                | property id/code/name/timezone, business date, `savedAt`, permissions used                                                        |
| Arrivals   | `/front-desk/arrivals?limit=200`           | `frontdesk:read` | reservation-room id, confirmation, guest name, VIP code, dates, nights, adults, children, ETA, room type code, room number, state |
| In house   | `/front-desk/in-house?limit=200`           | `frontdesk:read` | stay id, confirmation, guest name, VIP, room, room type, dates, status, checkout timing                                           |
| Departures | `/front-desk/departures?limit=200`         | `frontdesk:read` | as in house                                                                                                                       |
| Rooms      | `/rooms/board` (default page, 1 000 rooms) | `rooms:read`     | room id, number, type code, floor, board status, FO status, HK status, in-house guest name (null without `frontdesk:read`)        |

Never stored: e-mail, phone, addresses, documents, notes (`latestNote` is free text and is
dropped), rates, balances, folios, payments, cards, company data, audit data, tokens.
Lists above 200 rows keep the first page (documented limitation).

## E. Offline actions (candidates; phase 3, **not implemented — not available in this release**)

| Action              | Endpoint (existing)                                          | Concurrency token          | Offline rule                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assign room         | `POST …/reservation-rooms/:id/assign-room {version, roomId}` | reservation-room `version` | Only rooms the snapshot shows vacant and clean/inspected; optimistic local overlay; may conflict.                                                                                                       |
| Check-in            | `POST …/reservation-rooms/:id/check-in`                      | reservation-room `version` | Only rows `READY` in the snapshot; no deposit/payment capture offline (that stays online-only).                                                                                                         |
| Check-out           | `POST …/stays/:id/check-out`                                 | stay `version`             | Only when the snapshot shows no open balance flag; settlement stays online-only, so in practice "mark departed, settle on reconnect" needs a server rule change and is **not** proposed until reviewed. |
| Housekeeping status | `POST …/rooms/:id/mark-clean` / `mark-dirty` / `inspect`     | room `version`             | Safest candidate: idempotent in effect, small blast radius. **First to ship.**                                                                                                                          |

Every offline action becomes a queued operation (§H) and an optimistic overlay in the UI,
clearly marked "waiting to sync". Nothing is final until the server accepts it.

## F. Online-only (never offline)

Payments, refunds, voids, folio charges, adjustments, reversals, room charges, cash
movements and cashier shifts; night audit and business-date changes; reservation creation,
modification, cancellation and rate changes; group blocks pick-up/release; guest and company
profile edits; loyalty; user, role and permission management; configuration and setup; reports
and exports; audit trail; password and profile changes; walk-ins (need live availability and
rates); room moves (need live availability); extending stays (rates, availability).

## G. IndexedDB design

Database `serene-offline`, version 1 (`lib/offline/db.ts`), one per browser profile.

| Store       | Key                     | Indexes                                       | Content                                                         |
| ----------- | ----------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `meta`      | `key` (`"session"`)     | —                                             | `{ userId, displayName, lastOnlineAt }`: owner of all data here |
| `snapshots` | `key` (`user:property`) | `userId`                                      | `OfflineSnapshot` (policy.ts)                                   |
| `queue`     | `id` (UUID)             | `userProperty [userId, propertyId]`, `status` | `QueuedOperation` (policy.ts); empty in phase 1                 |

Rules: one owner at a time (`claimSession` wipes everything when a different user signs in);
all access through `db.ts`; every call degrades to a no-op when IndexedDB is unavailable;
a database without the expected stores is recreated; writes are announced over a
`BroadcastChannel` so every tab (and the indicator) refreshes. Upgrades bump `DB_VERSION` and
migrate in `onupgradeneeded`; never read another version's shape.

## H. Durable queue design (contract; phase 3)

```ts
interface QueuedOperation {
  id: string; // client UUID, sent as Idempotency-Key
  type:
    | "reservationRoom.assignRoom"
    | "reservationRoom.checkIn"
    | "stay.checkOut"
    | "room.markClean"
    | "room.markDirty";
  userId: string; // must equal the live session's user to sync
  propertyId: string; // must be accessible with the needed permission to sync
  entityId: string;
  baseVersion: number; // version the user saw; the server rejects if it moved
  payload: Record<string, unknown>;
  createdAt: number;
  sequence: number; // per property; replay order
  retries: number;
  status: "pending" | "syncing" | "synced" | "conflict" | "rejected" | "failed";
  error: { code; message; reason? } | null;
}
```

- Written in the same IndexedDB transaction as the optimistic overlay; survives reloads and
  restarts.
- Replayed strictly in `sequence` order per property, one at a time; an operation that
  depends on an earlier one (check-in after assign) waits for it and is marked `conflict`
  if the earlier one fails.
- Sync runs in the page (not only Background Sync, which Safari and Firefox lack): on
  reconnect (probe success), on app open, on visibility, and after each success. Background
  Sync may be added as an extra trigger in Chromium, never as the only one.
- A sync only starts when `/me` (live) returns the operation's `userId` and the property with
  the needed permission; otherwise operations stay paused with a visible reason.
- Sign-out with pending operations is blocked by a confirmation that lists them (phase 3); the
  current sign-out wipes the queue, which is safe only while nothing can enqueue.

## I. Conflict handling

The server is authoritative; the client never overwrites newer server data.

`classifySyncResponse` (policy.ts, unit-tested):

| Server answer                                                                                                               | Outcome          | Behaviour                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2xx                                                                                                                         | `synced`         | Drop overlay, refetch the entity.                                                                                            |
| 409 `STALE_VERSION` / `CONFLICT` / `IDEMPOTENCY_CONFLICT`, 422 business rule / invalid transition, 423 business date locked | `conflict`       | **Never retried automatically.** Overlay removed, server state shown next to the user's intent; the user redoes or discards. |
| 400, 403, 404                                                                                                               | `rejected`       | Invalid, no longer permitted or gone: shown, then discarded by the user.                                                     |
| 401                                                                                                                         | `reauthenticate` | Pause the queue; resume only after the same user signs in again.                                                             |
| 429, 5xx, network error                                                                                                     | `retry`          | Exponential backoff 2 s → 5 min cap.                                                                                         |

Stale version detection already exists for every candidate command. What does not exist yet
is recognising "this exact command already succeeded" after a lost response: without an
`Idempotency-Key` on those endpoints a replay after a lost 2xx returns 409/422 and would be
reported as a conflict (safe, but confusing). Hence the phase-3 prerequisite.

## J. Security and privacy

- No tokens, passwords or secrets anywhere client-side (auth cookies remain HttpOnly).
- Service worker caches only public resources; `/api/*`, authenticated HTML and RSC payloads
  are never cached (verified: no `/api` or property paths in Cache Storage).
- The `/offline` shell is fetched without credentials and renders no server data.
- Snapshot data is minimised (§D), expires after 24 h, and is only shown to its owner.
- Wiped on: sign-out (SignOutButton), any visit to the sign-in page (covers expired or
  revoked sessions), sign-in of a different user, "Clear offline data" in the indicator panel.
- Reconciled on every online workspace load against `/me`: snapshots of other users, of
  properties no longer accessible, or taken under a permission no longer held are deleted.
- CSP unchanged. No new dependencies.
- **Residual risk**: IndexedDB is not encrypted at rest by the app; anyone with access to the
  unlocked OS account can read the snapshot until it expires or is wiped, exactly as they could
  use the still-signed-in browser session. Mitigations: minimisation, 24 h expiry, sign-out
  wipe. Shared workstations must sign out at shift end (unchanged policy).

## K. Property isolation

- Keys are `userId:propertyId`; a snapshot is written only from inside that property's
  workspace (`PropertyProvider`).
- The offline view shows exactly one snapshot, chosen by the property in the URL being opened
  (`/offline?from=/SMR/...`). If that property has no copy it says so and offers the list;
  it **never substitutes another property's data** (verified: SDX copy present, SMR opened
  offline → "No offline copy of SMR").
- Tables are rendered from one snapshot object; no merged lists exist anywhere.
- Queue operations carry `propertyId` and replay only under that property's URL scope.

## L. PWA / service worker

- `public/sw.js` (scope `/`), registered by `components/offline/ServiceWorkerRegistration.tsx`
  in the root providers; secure contexts only.
- Install: cache `/offline` plus every `/_next/static` asset its HTML references (all or
  nothing), icon and manifest; `skipWaiting` + `clients.claim`.
- Refresh: pages ask for a new shell after online loads, at most every 30 min, so new deploys
  replace old chunks. Old `serene-*` caches are removed on activation; static cache capped at
  400 entries.
- `app/manifest.ts` → `/manifest.webmanifest` (installable, theme `#107c41`).
- `proxy.ts`: `/offline` public; `sw.js`, `manifest.webmanifest`, `icon.svg` excluded from
  the matcher (they must load without a session).
- **Production only**: `ServiceWorkerRegistration` registers the worker only when
  `NODE_ENV === "production"`. Under `next dev` the dev runtime (HMR, unhashed chunks) cannot
  run from a cached shell, so the worker is not registered there; any worker and `serene-*`
  caches left from an earlier registration are removed on the next dev page load. Snapshots,
  the indicator and `/offline` (online) still run in development for UI work; offline reloads
  can only be tested against `next build && next start`.

## M. Connectivity UX

`components/offline/ConnectivityStatus.tsx`, in the property workspace header:

| State                   | Presentation                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| Online, nothing pending | Quiet Wi-Fi icon button (screen readers: "Online")                   |
| Offline                 | Amber "Offline mode"; "Last synced …" from 1600 px, and in the panel |
| N waiting (phase 3)     | Amber "N changes waiting"                                            |
| Syncing (phase 3)       | Blue "Syncing…" with spinning icon                                   |
| N need attention        | Red "N changes need attention" (conflicts/rejections)                |

The panel explains what works offline, links to the offline view, re-checks the connection
and clears offline data. State changes are announced through a polite live region. The
offline view shows the same state, the snapshot age (warning past 2 h) and, on reconnect,
a "Return to the workspace" link to the page the user was opening.

## N. Prototyped (this spike)

| File                                                                       | Purpose                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `lib/offline/policy.ts`                                                    | Pure rules (keys, minimisation, expiry, reconcile, sync outcomes, backoff) |
| `lib/offline/db.ts`                                                        | IndexedDB store                                                            |
| `lib/offline/useConnectivity.ts`, `useOfflineStore.ts`                     | Probe-based connectivity; store as React state                             |
| `components/offline/OfflineSnapshotRecorder.tsx`                           | Snapshot lifecycle in the property workspace                               |
| `components/offline/ConnectivityStatus.tsx`                                | Header indicator                                                           |
| `components/offline/ServiceWorkerRegistration.tsx`                         | SW registration                                                            |
| `components/offline/ClearOfflineDataOnMount.tsx`                           | Wipe on the sign-in page                                                   |
| `app/(offline)/offline/…`                                                  | Read-only offline view                                                     |
| `public/sw.js`, `app/manifest.ts`                                          | Service worker, manifest                                                   |
| `proxy.ts`, `SignOutButton`, login page, `WorkspaceShell`, `providers.tsx` | Wiring                                                                     |
| `tests/unit/offline-policy.test.ts`                                        | 15 unit tests                                                              |

Browser verification (headless Chrome over CDP, network disabled with DevTools emulation on
the page **and** the service worker; production build behind local TLS): online load →
offline indicator → offline reload shows shell + "Offline mode" + SDX snapshot (2 arrivals,
29 rooms) → SMR opened offline shows "No offline copy of SMR" → reconnect shows "Back online"
and returns to the workspace → SMR and SDX snapshots kept separately and shown separately →
server unreachable while `navigator.onLine` is true shows "Offline mode" → revoking
`rooms:read` at SMR deletes the SMR snapshot on next load → deleting the database and "Clear
offline data" both empty the store and it is rebuilt online → sign-out empties the store and
the offline view shows no data → a second user signing in never sees the first user's data →
browser restart offline shows the shell and snapshot.

## O. Not implemented

Offline actions and the optimistic overlay; queue processing and conflict UI; server
idempotency for front-desk/housekeeping commands; Background Sync; offline pages other than the
front-office view (reservation detail, guest profile, housekeeping board); push updates of the
snapshot; encryption at rest; organization workspace indicator; storage quota monitoring;
snapshot of lists beyond 200 rows.

## P. Risks

| Risk                                                          | Mitigation                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Staff act on stale data (guest already checked out elsewhere) | Age shown everywhere, warning past 2 h, read-only in phase 1; version checks in phase 3.                              |
| Private data left on a shared PC                              | Minimisation, 24 h expiry, wipe on sign-out/sign-in; shift-end sign-out policy.                                       |
| Replay of a command whose response was lost                   | Phase-3 prerequisite: `Idempotency-Key` on those endpoints.                                                           |
| Old shell referencing chunks deleted after a deploy           | Shell and its assets are cached together; shell refreshed after online loads.                                         |
| Service worker bug breaking navigation                        | Network-first everywhere; the SW never answers online requests from cache; bump `VERSION` or unregister to roll back. |
| Browser evicts storage under pressure                         | Offline data is a convenience; the app works without it. `navigator.storage.persist()` considered in phase 2.         |
| Safari/Firefox differences                                    | No Background Sync dependency; feature-detected SW; IndexedDB wrapper degrades to no-op.                              |

Browser support assumed: current Chrome/Edge (primary front-desk browsers), Firefox and Safari
16.4+ for service workers, IndexedDB and BroadcastChannel. Private windows may block
IndexedDB/SW; the app then simply has no offline mode.

Performance: one snapshot is four list calls plus the room board (~5 requests, a few KB to
~200 KB) every 10 min per open, visible property tab; nothing runs in hidden tabs. The SW adds
no latency online beyond a network passthrough for navigations and static files.

## Q. Phases

1. **Read-only offline (done)**: shell, snapshot, indicator, isolation, wiping.
2. **Hardening**: organization-workspace indicator, `navigator.storage.persist()`, snapshot of
   the reservation card for arrivals (still minimised), Playwright offline test in CI against a
   production build, telemetry of offline sessions.
3. **Offline housekeeping status, then assign room and check-in**: server `Idempotency-Key`
   support for those endpoints (API change, reviewed separately), queue processor, optimistic
   overlay, conflict review UI, sign-out guard for pending operations.
4. **Check-out** only after a reviewed server rule for settling balances after an offline
   departure; payments stay online-only.
