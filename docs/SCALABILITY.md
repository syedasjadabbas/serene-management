# Scalability program — toward 100 000 requests per second

Status: **phase 1 (audit, baseline, evidence-backed fixes) done**. SERENE MANAGEMENT has
**not** been shown to handle 100 000 requests per second, and nothing in this document claims
it. What it does contain:

- the measured limits of the current system;
- the fixes that moved them, with before/after numbers;
- the architecture and test plan a credible 100K claim would need.

Every number is labelled:

- **MEASURED**: from a load test described here.
- **ESTIMATED**: derived from measured numbers with stated assumptions.
- **PROPOSED**: a design not yet built.

Decision D58 in `docs/ARCHITECTURE.md` §15.

---

## 1. Executive summary

- **MEASURED, one application instance, realistic mix, large dataset.** Before this phase the
  system saturated between **10 and 25 dynamic requests per second**:
  - p95 at 10 req/s was 1.4 s;
  - at 25 req/s p95 reached 6.9 s and PostgreSQL spilled ~200 MB/s to temp files.

  After four evidence-backed fixes (§15) the same instance is stable at **50 req/s** (p95 192 ms,
  p99 513 ms, 0 errors, no temp files) and tips over at **≈70 req/s**. On this machine the tipping
  point is the single Node.js event loop plus the shared CPU.

- **MEASURED, the ceilings on this machine (4-core laptop i5-8365U, everything co-located):**
  - A bare Node.js HTTP server: 9 856 req/s.
  - A trivial Next.js route handler (`/api/health/live`, no DB): ~650 req/s per process. That is
    ≈1.5 ms of framework CPU per request.
  - An authenticated no-op (`/me`, three auth queries): ~200 req/s.
  - Four instances reached ≈90 req/s of the realistic mix before the **whole laptop hit 100% CPU**
    (PostgreSQL, k6, Windows Defender and desktop processes share it).
- **ESTIMATED.** 100K total HTTP req/s corresponds to roughly 50K dynamic application req/s and
  ~50K database-backed req/s (§4). At the measured per-request database cost that needs
  **hundreds of application cores and far more PostgreSQL capacity than one primary provides**,
  unless per-request database work is cut substantially (§18, §20).
- **Conclusion.** The largest avoidable costs were query shapes that scaled with history. They
  were fixed where the evidence was unambiguous. The remaining gap to 100K is architectural:
  - per-request authentication queries;
  - polling;
  - search;
  - a single PostgreSQL primary;
  - per-instance rate limits;
  - no production-class test environment.

  This machine cannot generate or sustain a credible 100K test (§23).

## 2. Current architecture (audited)

**Request path of an authenticated API GET** (MEASURED: 5 SQL statements for
`/front-desk/arrivals`, none cached across requests):

```
HTTP → Next.js router (framework ≈1.5 ms CPU) → route definer (lib/http/route.ts)
  → [writes: Origin check + per-IP write limit, in memory]
  → JWT verify (jose HS256, no DB)
  → resolveSession: 3 sequential SQL statements, each its own pool checkout
       1. auth_sessions ⋈ users ⋈ organizations ⟕ user_avatars (revocation, status, password change)
       2. role grants (user_role_assignments ⋈ roles ⋈ role_permissions)
       3. active properties ⟕ current business dates
  → per-route rate limit (in memory, per user) → property + permission check (in memory)
  → Zod validation → service → repository (Prisma / raw SQL) → PostgreSQL
  → NextResponse.json, cache-control: no-store
```

**Components:**

- **Pages.** They render only a client component: no server data fetching beyond one cached
  `getServerSession` per render. All data comes through RTK Query API calls, each authenticated
  separately.
- **Database access.** One Prisma client per process, over a `pg` pool with max 10 connections
  (`DATABASE_POOL_MAX`), statement timeout 30 s, and idle-in-transaction timeout 60 s.
- **Rate limiting.** In process memory (`lib/http/rate-limit.ts`). Only a few read endpoints are
  limited: availability 60/min per user, reports 120/min per user.
- **Logging.** Errors only; no request or latency logging. The `x-request-id` header is echoed
  and stored on audit rows.
- **State.** No background workers, queues, SSE or WebSockets: the UI polls every 60–120 s.
  Night audit and reports run inside the HTTP request.
- **Offline.** The service worker caches only static assets and the `/offline` shell, and is
  registered in production only (`docs/OFFLINE_ARCHITECTURE.md`).

## 3. Current measured baseline

**Environment (all MEASURED runs):**

- **Hardware.** Windows 11 laptop, Intel i5-8365U (4 cores / 8 threads, 1.6 GHz base), 16 GB RAM.
- **Database.** PostgreSQL 18.6 native, default settings: `shared_buffers` 128 MB, `work_mem`
  4 MB, `max_connections` 100.
- **Application.** `next build && next start` (production), one process on :3100,
  `NODE_ENV=production`, `SERVER_TIMING=1`.
- **Load generator.** k6 v2.1.0 on the same machine.
- **Other load on the machine.** A developer `next dev` server and desktop software were running
  (disclosed: they share the CPU).
- **Dataset.** The benchmark dataset (§14).
- **Sessions.** 200 benchmark users, each with its own simulated client IP.

**Per-endpoint capacity (closed model: 16 concurrent users back to back, 20 s each; MEASURED).**

| Class                          | req/s | p50 ms | p95 ms | Tuples read per request |
| ------------------------------ | ----: | -----: | -----: | ----------------------: |
| static asset (`/_next/static`) |  1144 |     13 |     17 |                       0 |
| health (no DB)                 |   456 |     33 |     42 |                       0 |
| public page `/login`           |    96 |    127 |    359 |                       — |
| authenticated page (HTML/RSC)  |    52 |    281 |    366 |                       — |
| `/me`                          |   195 |     77 |    101 |                     205 |
| business date (polled)         |   146 |    105 |    138 |                     210 |
| front-desk summary             |    45 |    341 |    471 |                  18 139 |
| arrivals                       |    69 |    224 |    292 |                     475 |
| in house                       |    93 |    164 |    214 |                   1 174 |
| room board                     |    42 |    364 |    472 |                  18 850 |
| housekeeping summary           |   123 |    126 |    157 |                     183 |
| reservation list               | **5** |  3 170 |  4 550 |                  84 958 |
| reservation search             | **3** |  4 389 |  6 055 |                  37 913 |
| guest search                   |    27 |    582 |  1 079 |                   3 511 |
| guest note (write)             |    22 |    667 |  1 029 |                   9 284 |
| global search — folio source   |     — |  8 344 |  8 928 |                       — |

**Realistic mix, open model, step test (30 s per rate, one instance; MEASURED).** Before the fixes:

| Target | Achieved | Errors | p50 ms | p95 ms | p99 ms | PG CPU (cores) | Temp spill |
| -----: | -------: | -----: | -----: | -----: | -----: | -------------: | ---------: |
|     10 |       10 |     0% |     43 |  1 415 |  1 839 |           0.92 |    66 MB/s |
|     25 |       20 |     0% |  1 726 |  6 912 |  8 536 |           1.90 |   194 MB/s |

A 25→250 req/s ramp (MEASURED) failed 64% of requests (p50 11 s). Saturation point before:
**between 10 and 25 req/s.**

## 4. Definition of the 100K RPS target

"100 000 requests per second" is not one number. It must be split by where a request stops.

| Class                     | Examples                                               | Served by                                         | Share of total HTTP (ESTIMATED) |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------- | ------------------------------: |
| A. Static assets          | JS, CSS, fonts, icons (content-hashed, immutable)      | Browser cache, then CDN; SW for the offline shell |                         40–50 % |
| B. Public pages           | `/login`, `/offline`, `/reset-password`                | Next.js (nonce CSP makes them dynamic)            |                           < 1 % |
| C. Authenticated HTML/RSC | page loads and client navigations                      | Next.js, one session resolution each              |                           3–5 % |
| D. Authenticated reads    | lists, boards, summaries, business-date poll           | Next.js route → PostgreSQL                        |                         40–50 % |
| E. Writes                 | check-in, notes, postings                              | Next.js route → PostgreSQL transaction            |                           1–3 % |
| F. Search / filter        | global search (6 requests per keystroke), list filters | Next.js → PostgreSQL (trigram / LIKE)             |                           2–5 % |
| G. Reports / aggregation  | manager flash, ledgers, exports                        | Next.js → PostgreSQL (synchronous)                |                           < 1 % |
| H. Background / expensive | night audit (5 min transaction), central availability  | Synchronous HTTP today                            |                           ≪ 1 % |

**Three different numbers:**

- **Total HTTP req/s.** Everything, including A.
- **Dynamic application req/s.** B–H: every request that runs Next.js code.
- **Database-backed req/s.** C–H: every one runs ≥3 SQL statements for authentication alone.

For a 100K total target: A ≈ 45–50K (CDN, browser cache), dynamic ≈ 50–55K, database-backed
≈ 50K requests/s ≈ **250–400K SQL statements/s** (ESTIMATED: 3 auth + 2–5 handler statements).

**What can be cached safely:**

- Class A, forever (hashed names).
- Nothing else in a shared cache: every other response is per-user and property-scoped, and
  returns `cache-control: no-store`.
- **Must stay strongly consistent:** room status, availability and inventory, folios and payments,
  business date, session and permission checks.

**Scale implied (ESTIMATED).** A staff browser generates ≈0.08–0.1 dynamic req/s: a 60 s
business-date poll, a 60–120 s page poll, and an action every 20–30 s. 50K dynamic req/s is
therefore ≈500 000–600 000 concurrently active staff sessions, i.e. tens of thousands of hotels.
The client should confirm this is the intended scale. A 1 000-hotel chain needs ≈2–5K dynamic
req/s.

## 5. Traffic model (load test mix)

`scripts/load/k6/pms-mix.js`. The mix covers dynamic API traffic only (classes C–G). Weights in
percent are adjustable with `MIX='{"me":1,…}'`.

| Request                |   % | Request                          |   % |
| ---------------------- | --: | -------------------------------- | --: |
| business-date poll     |  20 | reservation list                 |   7 |
| arrivals               |   8 | reservation search               |   5 |
| room board             |   7 | `/me`                            |   5 |
| front-desk summary     |   6 | guest search                     |   4 |
| in house               |   6 | availability (1–4 nights, +30 d) |   4 |
| housekeeping tasks     |   6 | dashboard                        |   4 |
| departures             |   4 | folio list (in house)            |   3 |
| housekeeping summary   |   3 | folio read                       |   3 |
| maintenance summary    |   3 | report (manager flash)           |   1 |
| guest note (**write**) |   1 |                                  |     |

Other classes can be run alone with `ONLY=`:

- `healthLive`, `publicPage`, `staticAsset`, `pageFrontDesk`;
- the global-search sources;
- `globalSearch`: the six parallel requests of one keystroke.

## 6. Bottlenecks ranked by evidence

1. **Relation `_count` compiled to a whole-table aggregate** (fixed).

   Reservation list, stay detail and company history used Prisma
   `_count: { select: { rooms: true } }`. Prisma 7 emits
   `LEFT JOIN (SELECT … COUNT(*) FROM reservation_rooms WHERE 1=1 GROUP BY …)`, an aggregate of
   **every** reservation room on each request.

   MEASURED: ≈1 s per list request, 85K tuples per request, and temp-file spills that starved
   every other endpoint.

2. **Global search, folio source: 8.3 s per keystroke with one user** (fixed to ≈0.45 s).

   `(name LIKE … OR confirmation LIKE … OR room = …)` across three tables used no index. The plan
   sorted all 300K guests on disk and walked 135K reservation rooms (965K buffers).

3. **Head-of-line blocking** (consequence).

   One slow endpoint holds pool connections, so everything queues. MEASURED at 25 req/s: `/me`
   auth time went from 8 ms to 550 ms because the pool was busy with reservation lists.

4. **Guest statistics `primary_guest_id = g OR EXISTS (sharer)`** (fixed).

   This scanned all of the properties' reservation rooms on every profile view and every note
   write. MEASURED: 168 ms → 0.16 ms per query.

5. **Room board: per-room walk of all housekeeping history** (fixed with an index).

   It is also run inside every front-desk summary. MEASURED: 38 346 → 4 967 buffers per board.

6. **Single-threaded Node.js per instance** (architecture).

   MEASURED: ~1.5 ms framework CPU per request, and ~20 ms of JS per room-board response
   (134 KB). One process saturates at ≈50 req/s for boards and ≈650 req/s for a no-op.

7. **Authentication: three sequential SQL statements per request, nothing cached** (proposed, §18).

   MEASURED: `/me` peaks at ~200 req/s against 650 req/s without auth, i.e. ≈2.5 ms of
   event-loop time per request. `business-date` (20% of traffic) is almost entirely auth.

8. **Search and filters that scale with history** (partly fixed, rest proposed):
   - guest name search (100–230 ms for alphabetically late names);
   - reservation search (≈330 ms);
   - housekeeping `business_date < D` arms;
   - maintenance `view=all` ILIKE;
   - the groups list aggregating every group before LIMIT.
9. **Polling as the real-time mechanism.** Each open screen polls every 60–120 s;
   business-date alone is 20% of API traffic (§18).
10. **Per-instance in-memory rate limits** (correctness at scale, §12).

## 7. Database findings

**Method:**

- EXPLAIN (ANALYZE, BUFFERS) on the benchmark database.
- A `pg_stat_activity` sampling profiler during load, `scripts/load/pg-sample.mjs`. It stands in
  for `pg_stat_statements`, which needs superuser server configuration.

**MEASURED results (per request, 300-room property, 200K stays of history):**

| Query                                  | Before                | After               | Change                                             |
| -------------------------------------- | --------------------- | ------------------- | -------------------------------------------------- |
| reservation list `_count` aggregate    | ≈900 ms, temp spill   | removed             | room ids of the page (§15)                         |
| folio search `q=khan` / `zhang` / `al` | 4.3 s / 7.7 s / 0.8 s | 0.43 / 0.42 / 1.0 s | UNION of index-served candidates                   |
| guest statistics                       | 168 ms                | 0.16 ms             | IN (primary UNION sharer)                          |
| room board SQL                         | 47 ms, 38K buffers    | 5K buffers          | partial index                                      |
| arrivals (PG 18 skip scan on stays)    | 4.7 ms                | —                   | `property_id` in join: 2.4 ms (not applied; small) |

**Guest name search (not changed; MEASURED, 300K guests):**

| Plan                        |  ahmed |     al | iqbal |   khan |  zhang |
| --------------------------- | -----: | -----: | ----: | -----: | -----: |
| name-ordered walk (current) | 0.3 ms | 1.6 ms | 84 ms | 102 ms | 233 ms |
| trigram first               |  38 ms | 172 ms | 13 ms |  15 ms |  15 ms |

Neither wins everywhere. A proper search index is proposed (§18).

**Other findings (audit; not changed; no measured evidence in the mix):**

- Night audit `countRoomTypesForNight` subqueries lack `property_id` (whole-table scans inside a
  5-minute transaction).
- Block-pickup laterals on `rr.block_id` without a leading index.
- Ledger reports summing the entire history (guest ledger, roll-forward opening, production
  reports with no `revenue_date` index).
- No partitioning or archival for `folio_items`, `audit_logs`, `room_status_history`.
- The per-property confirmation counter row serializes bookings per property (a write ceiling
  per property).

These need their own measured tests (night-audit volume test, reports at volume) before indexes
are added.

## 8. Prisma and connection findings

- **One `PrismaClient` per process** (`lib/db/prisma.ts`) over one `pg` pool. Pool max 10,
  connect timeout 5 s, idle 30 s. No multiplication.
- **MEASURED:** raising the pool to 20 changed nothing (`/me` 201 → 207 req/s; mix tipping point
  unchanged at ≈70 req/s). The pool is not the constraint; the event loop is.
- **Connection pressure (ESTIMATED; `max_connections` 100 today, pool 10 per instance):**

| App instances | Pool connections | Against 100 max_connections                   |
| ------------: | ---------------: | --------------------------------------------- |
|            10 |              100 | exhausted (no headroom for migrations, admin) |
|            20 |              200 | refused: "too many clients"                   |
|            50 |              500 | impossible without a pooler                   |
|           100 |            1 000 | impossible without a pooler                   |

- **PROPOSED: PgBouncer** (or a managed pooler) in **transaction mode** in front of the primary,
  with ≈50–150 server connections. Caveat: the app sets `statement_timeout`,
  `idle_in_transaction_session_timeout` and `TimeZone` as startup options (`pool-config.ts`).
  Transaction pooling does not carry startup options, so they must move to the role or database
  (`ALTER ROLE … SET`), which D52 already recommends.

## 9. Next.js / application-server findings

- **Framework cost per request is the floor** (MEASURED ≈1.5 ms CPU on this core). The CPU
  profile shows it spread over Next.js router, base server, web streams, AsyncLocalStorage and
  tracing. It is not app code and cannot be tuned away inside the app.
- **Pages are dynamic.** The nonce CSP (`await connection()` in the root layout) forces
  per-request rendering. Authenticated pages must stay dynamic and private. Public pages could be
  static only by giving up the per-request nonce (not proposed: CSP stays).
- **Large payloads.** Room board 134 KB of JSON per poll (300 rooms); arrivals and in-house
  ≈38 KB. Compression (gzip) is on by default under `next start`. Offloading it to the reverse
  proxy saves app CPU (PROPOSED).
- **No server-side data caching exists or is needed for correctness.** Candidates in §11.

## 10. Authentication hot path

MEASURED at one user:

- `/me` total 4.1 ms, of which auth 3.9 ms: three round trips plus Prisma mapping.
- JWT verify (no DB) is negligible.
- Under saturation auth shows 50–100 ms: queueing, not SQL. PostgreSQL CPU for `/me` was ≈6%.

**Not changed in this phase.** Parallelizing the queries lowers idle latency but not the
event-loop CPU that caps throughput. Collapsing them into one statement touches the session and
revocation code and deserves its own reviewed change.

**PROPOSED (identical semantics required):**

- **(a)** One SQL statement returning session, grants and properties together (one pool
  checkout, one result mapping).
- **(b)** A per-instance cache of grants and properties for ≤2–5 s keyed by
  `(sessionId, user.updated_at, roles version)`. Revocation checks (`auth_sessions.revoked_at`,
  user status, password change) stay per request. The cache only takes effect with an
  invalidation signal (a roles or permissions version bump), otherwise a revoked permission
  could live for the TTL.
- **(c)** Not proposed: caching the session row itself. That would delay logout and disable.

## 11. Search and filter findings

- **Global search** sends **6 requests per debounced keystroke** in the property workspace:
  reservations, guests, folios `view=all`, accounts, groups, maintenance `view=all`.

  MEASURED after the fix, one user: a keystroke p95 600 ms (was 5.7 s). With 8 users typing:
  p95 2.65 s (was 18.5 s) and ≈0.5 PostgreSQL cores for 3 keystrokes/s. It remains the most
  expensive user action.

- **PROPOSED: one search endpoint.** One request, one authentication, the property's candidates
  from a dedicated search table:
  - guest name, confirmation and room per reservation room;
  - trigram or full-text indexed;
  - maintained in the write transactions or by a trigger.
- **Reservation search** (≈330 ms), **guest search** (0.3–230 ms by name position), maintenance
  and groups `view=all` ILIKE: same approach.
- **Pagination.** Lists are keyset (cursor) paginated with LIMIT (good), with two exceptions: the
  users list (offset + `COUNT(*)`, small table) and report paging, which re-runs the whole report
  per page (≤20K rows). The room board returns every room by design (M11).

## 12. Cache and rate-limit findings

**Cache:**

- Only the RTK Query in-browser cache (30 s) and the service worker's static cache exist.
- **SAFE TO CACHE:**
  - static assets (CDN, immutable);
  - reference data per property (room types, floors, rate plans, reason codes) per instance for
    seconds, with invalidation on the rare writes;
  - the organization's property list.
- **MUST BE LIVE:**
  - room and housekeeping status, availability and inventory;
  - folios, payments, cashiering;
  - business date and night-audit state;
  - session validity and revocation.
- **Redis is not justified yet.** Nothing measured needs a shared cache. The first need will be
  the distributed rate limiter (below), which can also be a PostgreSQL table at modest scale.

**Rate limits (audit, ESTIMATED effect):**

- The stores are per process, so with N instances behind a round-robin balancer every limit
  becomes up to N×. At 50 instances that means per-account login 500/15 min, availability 3000/min
  per user, write flood guard 15 000/min per IP.
- This weakens brute-force and abuse protection as instances are added.
- **PROPOSED:** register a shared store through the existing `setRateLimitStore`: Redis
  `INCR`+`EXPIRE`, or a PostgreSQL `rate_limit_windows` table with `INSERT … ON CONFLICT DO UPDATE`
  (fine to a few thousand writes per second).
- The per-account login lock that lives in the database (D45) is already global.

## 13. Observability findings

**Before this phase:** no request, latency or DB-time visibility at all (errors only).

**Added (minimal, off by default):**

- `SERVER_TIMING=1` adds `Server-Timing: auth;dur=…, total;dur=…` to API responses. No logging,
  no data. Tested absent by default.
- Load-test tools in `scripts/load/`:
  - `monitor.mjs`: application and PostgreSQL CPU, memory, connections, lock waits, cache hit,
    temp bytes, commits/s;
  - `pg-sample.mjs`: which statements hold the database, with their wait events.

**PROPOSED for production:**

- Per-route RED metrics (rate, errors, duration histograms) exported via OpenTelemetry.
- `pg_stat_statements` and `auto_explain` (log_min_duration 250 ms) on the database.
- Pool wait time metric.
- Sampling of slow requests only (no per-request logs at high RPS; never guest or payment data).

## 14. Large-data findings

**Generator:** `scripts/load/seed-benchmark.mjs`.

- Non-production only: it refuses unless the database name ends in `_bench`.
- Runs after `db:deploy` and the demo seed.
- About 12 minutes on the test laptop, set-based SQL.

**Dataset used (MEASURED sizes, 3.0 GB):**

| Table                            |                        Rows |
| -------------------------------- | --------------------------: |
| properties / rooms               |  2 / 600 (300 per property) |
| guests                           |                     300 000 |
| reservations / reservation rooms |                     407 588 |
| stays / folios / payments        | 400 362 / 400 362 / 400 000 |
| reservation room nights          |                   1 019 160 |
| folio items                      |                   1 600 445 |
| audit logs                       |                   1 600 098 |
| room status history              |                     800 008 |
| housekeeping tasks               |                      65 417 |

This is about three years of history for two busy 300-room hotels, plus today's in-house guests
(≈60%) and 60 days of future bookings.

**Findings:**

- Every query that degraded did so because it scaled with **history**, not with today's
  workload: aggregates over all reservation rooms, OR-scans, per-room history walks.
- The next growth risks are the report and night-audit paths listed in §7.
- Partitioning `folio_items` / `audit_logs` by date (DATABASE_DESIGN §7) becomes relevant beyond
  tens of millions of rows.

## 15. Changes implemented

Each change is explained by its observed bottleneck, evidence, expected effect and risk.

1. **Reservation room counts without a relation `_count`.**
   - **Where:** `reservations.repository.ts` list select, `front-desk.repository.ts` stay detail,
     `accounts.repository.ts` company reservations. Each now selects the reservation's room ids;
     the services count them.
   - **Evidence:** a whole-table GROUP BY per request (§6.1).
   - **Effect:** reservation list 5 → 48 req/s, p50 3.2 s → 0.30 s.
   - **Risk:** none to semantics (the same count). A reservation has ≤ `MAX_ROOMS_PER_BOOKING`
     rooms, so the extra ids are tiny.
2. **Folio search as a UNION of candidates** (`billing.repository.ts`, `findFolioListPage`).
   - **Evidence:** 4–8 s per call, identical result sets verified on 3 terms.
   - **Effect:** 10–18× faster for terms of 3+ characters.
   - **Risk:** 2-character terms that match many names are ≈20% slower (0.8 → 1.0 s); documented.
3. **Guest statistics and history: IN (primary UNION sharer)** (`guests.repository.ts`).
   - **Evidence:** 168 ms → 0.16 ms.
   - **Risk:** same rows by construction; covered by new tests, including a sharer-only guest.
4. **Partial index `housekeeping_tasks_live_idx`.**
   - **Migration:** `20261130090000_idx_housekeeping_tasks_live`, CONCURRENTLY, own file,
     applied to native PostgreSQL 18.6.
   - **Why a schema change:** the query already filters to live tasks. Only an index containing
     just those rows lets each room's lookup skip its history. No query rewrite could do that.
   - **Evidence:** 38K → 5K buffers per room board.
   - **Risk:** small write cost on task inserts and updates.
5. **Opt-in `Server-Timing`** (`lib/http/route.ts`, `lib/env.ts` `SERVER_TIMING`, default off).
6. **Load-testing kit** (`scripts/load/`), all non-production and name-guarded:
   - the k6 mix;
   - the benchmark data generator;
   - benchmark users;
   - the one-time sign-in;
   - the monitor;
   - the PostgreSQL sampler.

**Not changed:**

- business rules, RBAC, authentication and session semantics, property isolation;
- existing migrations, CSP;
- configuration defaults: pool 10 was kept because the evidence showed no gain at 20.

## 16. Before / after benchmark

**Realistic mix, one instance, open model, 30 s per step (MEASURED, same machine, dataset and
script):**

| Target req/s | Before: achieved / p95 / errors | After: achieved / p95 / p99 / errors      | After: app CPU / PG CPU |
| -----------: | ------------------------------- | ----------------------------------------- | ----------------------- |
|           10 | 10 / 1 415 ms / 0%              | 10 / 223 ms / 373 ms / 0%                 | 0.09 / 0.13 cores       |
|           25 | 20 / 6 912 ms / 0% (saturated)  | 25 / 210 ms / 328 ms / 0%                 | 0.15 / 0.34             |
|           50 | —                               | 49 / 192 ms / 513 ms / 0%                 | 0.22 / 0.53             |
|           75 | —                               | 69 / 3 383 ms / 3 997 ms / 0% (saturated) | 0.39 / 2.31             |
|          100 | —                               | 68 / 9 893 ms / 0% (saturated)            | 0.62 / 1.56             |

- **Temp-file spill:** 66–194 MB/s before, **0** after.
- **Buffer cache hit:** 87–88% before, 98–99% after.
- **Lock waits:** none in either.

**Per-endpoint (closed model, 16 users, MEASURED):**

| Class                 |         Before req/s (p50) | After req/s (p50) | Tuples read per request |
| --------------------- | -------------------------: | ----------------: | ----------------------: |
| reservation list      |               5 (3 170 ms) |       48 (300 ms) |            84 958 → 692 |
| reservation search    |               3 (4 389 ms) |       36 (327 ms) |          37 913 → 2 086 |
| guest note (write)    |                22 (667 ms) |       51 (295 ms) |             9 284 → 300 |
| room board            |                42 (364 ms) |       56 (275 ms) |          18 850 → 2 175 |
| front-desk summary    |                45 (341 ms) |       62 (253 ms) |          18 139 → 2 139 |
| global search, 1 user | p95 5 671 ms per keystroke |        p95 601 ms |                       — |

**Variance, not hidden.** Classes whose code was **not** changed measured 20–30% lower in the
later runs, and did so repeatably:

- maintenance summary 216 → 149 req/s;
- availability 97 → 73;
- folio read 135 → 94;
- dashboard 125 → 99;
- reports 155 → 120.

Meanwhile the no-DB route and `/me` were unchanged. The cause was not isolated. Planner
statistics after the bulk updates and the machine's other load are suspects. Treat single-class
numbers on this machine as ±30%. The mix step tests above are the primary evidence.

## 17. Current measured capacity

- **One instance on this laptop, realistic mix:** sustainable **≈50 dynamic req/s** at
  p95 < 200 ms. Tipping point ≈70 req/s.
- **Four instances on the same laptop:** ≈90 req/s before the machine hit 100% CPU. The
  environment is the limit, not the application.
- **Resilience (MEASURED):**
  - Killing one of four instances during a 40 req/s run failed 8.1% of all requests. These were
    the requests the client-side round-robin kept sending to the dead instance; there is no
    health-checked balancer in this test.
  - The same sessions kept working on the other instances, so the application is stateless apart
    from rate limits.
  - Slow queries cause head-of-line blocking of all endpoints (§6.3). The statement timeout
    (30 s) is the only bound.

## 18. Production-scale architecture required (PROPOSED)

Every component is tied to a measured or audited need.

```
Browser ──► CDN (static /_next/static, immutable; class A ≈45–50% of requests)
   │
   ▼
L7 load balancer (health checks, no affinity needed — sessions live in PostgreSQL; TLS, gzip/brotli)
   │
   ▼
N × stateless Next.js instances (1 process per core; containers or PM2/cluster)
   │    • shared rate-limit store (Redis or PG table) via setRateLimitStore
   │    • per-instance short cache of reference data (seconds, invalidated)
   ▼
Connection pooler (PgBouncer transaction mode; timeouts as role settings)
   │
   ├──► PostgreSQL primary (writes, strongly consistent reads: status, folios, availability)
   └──► read replicas (reports, search, history, dashboards — tolerate ≤1 s lag)
   │
   ▼
Job queue + workers (night audit, large reports/exports, central availability fan-out)
Push channel (SSE/WebSocket fed by the existing outbox) to replace 60 s polling
```

**Scaling units:**

- App instances scale by CPU.
- The database scales first by removing per-request work: auth statements, polling, search.
- Then by replicas for reads.
- Then by partitioning large tables.
- Then, if ever needed, by sharding by organization or property. Property scoping is already in
  every query and key.

**Biggest levers on database-backed req/s (ESTIMATED):**

- **(1)** Push instead of polling. Business-date and board polls are ≈35% of API requests.
- **(2)** One-statement authentication plus short grant caching: −2 statements per request.
- **(3)** A single search endpoint and table: 6 requests per keystroke → 1.

**Failure modes and single points of failure:**

- PostgreSQL primary: needs HA failover and PITR (backups exist, OPERATIONS.md).
- Pooler: run it redundantly.
- Load balancer.
- Rate-limit store: fail open for reads, fail closed for login.
- A slow query holding connections: statement timeouts per route class, separate pools for
  reports.

**Disaster recovery:** existing backups and PITR, plus a replica in a second zone.

## 19. Infrastructure assumptions for a credible 100K test

- **Load generation.** ≥5–10 k6 generators (or k6 distributed or cloud execution), each
  ≤10–20K req/s, in the same region as the system, with the network capacity checked. Payloads
  up to 134 KB mean ≥ several Gbit/s at peak.
- **Application.**
  - ESTIMATED from 1.5 ms of framework CPU and ~5–15 ms of mix CPU per request on this core:
    ≈150–350 req/s per modern server core, i.e. **≈150–350 cores** for 50K dynamic req/s. To be
    replaced by a measured per-core figure on the target hardware.
- **Database.**
  - Production-class PostgreSQL (≥32–64 vCPU, RAM ≥ working set, NVMe).
  - Tuned `shared_buffers` and `work_mem`.
  - PgBouncer.
  - 2+ read replicas.
- **Other components.**
  - CDN in front of static assets.
  - A shared rate-limit store.
- **Test contents.**
  - The mix of §5 at scale.
  - A production-sized dataset (e.g. 1 000 properties with the §14 depth per property).
  - Sustained runs of ≥30 min.
  - Staged 25K → 50K → 75K → 100K steps.

## 20. Remaining gap to 100K RPS

| Gap                                                   | Evidence                  | Size of gap (ESTIMATED)                 |
| ----------------------------------------------------- | ------------------------- | --------------------------------------- |
| Measured dynamic capacity vs target                   | ≈50–90 req/s here vs ≈50K | ~3 orders of magnitude, mostly hardware |
| Per-request SQL: 3 auth + 2–5 handler statements      | §2, §10                   | 250–400K statements/s at target         |
| Single PostgreSQL primary, no pooler, 100 connections | §8                        | blocks >10 instances                    |
| Polling (≈35% of API calls)                           | §5 mix, audit             | needs push channel                      |
| Global search fan-out and history-scaling searches    | §11                       | needs search endpoint and table         |
| Per-instance rate limits                              | §12                       | protections weaken linearly with N      |
| Synchronous night audit and reports                   | audit §7                  | need job queue                          |
| No production-like environment or observability       | §13, §19                  | a 100K claim is impossible without it   |

## 21. Risks

- **Scope risk.** 100K req/s may exceed the real need by 10–100× (§4). Confirm the target in
  hotels and active users before buying infrastructure.
- **Correctness under caching.** Any session or permission cache must keep revocation semantics
  (§10). Shared caches must never hold property data.
- **Rate limits at N instances** silently multiply (§12).
- **Benchmark validity.**
  - Laptop numbers include co-located load generator, database and desktop software.
  - Single-class numbers vary ±30% (§16).
  - Absolute numbers will differ on server hardware; ratios and bottleneck order are the durable
    findings.
- **New index write cost** on housekeeping tasks (small).
- **Folio search:** 2-character terms slightly slower (§15.2).

## 22. Recommended next phase

1. Confirm the business target (hotels, concurrent staff, peak events).
2. Stand up a production-like staging environment:
   - 2–3 app nodes;
   - a PostgreSQL primary and a replica;
   - PgBouncer, a load balancer, a CDN;
   - `pg_stat_statements`, OpenTelemetry.
3. Measure req/s per core on target hardware with this kit.
4. Implement, in order of database-load reduction:
   - one-statement authentication;
   - the shared rate-limit store;
   - a push channel from the outbox (drop business-date and board polling);
   - the unified search endpoint and table;
   - role-level timeouts plus PgBouncer.
5. Night audit and reports into a job queue after a measured volume test.
6. Re-run the step tests, then staged 25K → 100K with a sustained 30-minute run. Record the claim
   format of §23.

## 23. 100K acceptance test

**It cannot be run credibly from this environment.**

- One laptop generates, serves and stores at once.
- Its whole CPU saturates at ≈90 dynamic req/s of the mix, and ≈10K req/s for a bare Node
  server.
- A 100K claim requires §19's environment.

**It is valid only if it states all of the following:**

- traffic mix;
- duration (≥30 min sustained);
- environment and hardware;
- number of application instances;
- database configuration (primary, replicas, pooler);
- cache configuration;
- load generators;
- p95 and p99 per class;
- error rate;
- saturation margin (the step above the target still passes, or the headroom is shown).

## 24. How to reproduce

```bash
# 1. Benchmark database (native PostgreSQL; the role needs CREATEDB)
createdb serene_bench            # or via psql; the name must end in _bench
DATABASE_URL=…/serene_bench npm run db:deploy
DATABASE_URL=…/serene_bench SEED_DEMO=true SEED_DEMO_PASSWORD=… npm run db:seed
DATABASE_URL=…/serene_bench node scripts/load/seed-benchmark.mjs
DATABASE_URL=…/serene_bench BENCH_PASSWORD=… BENCH_USERS=200 node scripts/load/bench-users.mjs
# 2. Production server under test
npm run build
DATABASE_URL=…/serene_bench APP_URL=https://pms.serene-bench.test TRUSTED_PROXY_HOPS=1 \
  SERVER_TIMING=1 NODE_ENV=production node node_modules/next/dist/bin/next start -p 3100
# 3. Sessions (valid 15 min) and a step
BENCH_PASSWORD=… BENCH_USERS=200 node scripts/load/login.mjs tokens.json
k6 run -e TOKENS=tokens.json -e BENCH_USERS=200 -e RATE=50 -e DURATION=30s scripts/load/k6/pms-mix.js
# per class, closed model:            -e ONLY=roomBoard -e MODE=vus -e VUS=16 -e DURATION=20s
# several instances:                  -e BASES=http://h:3100,http://h:3101
# 4. While it runs
DATABASE_URL=… node scripts/load/monitor.mjs <server pid> 30 out.json
DATABASE_URL=… node scripts/load/pg-sample.mjs 20
```
