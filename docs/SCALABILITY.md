# Scalability program — toward 100 000 requests per second

Status: **phases 1–6 done**: audit, baseline and fixes; authentication and shared rate limiting
(§25–26); search (§28–30); live updates (§31); connection pooling (§32); background jobs (§33);
the night-audit balance check (§34); read scaling and replica readiness (§35); guest search (§36).
SERENE MANAGEMENT has
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

---

# Phase 2 — authentication hot path and shared rate limiting

## 25. Authentication hot path

### 25.1 Flow before the change (audited)

1. `proxy.ts`, pages only: JWT signature and expiry check (no database).
2. API: `lib/http/route.ts` `authenticate`. It verifies the JWT (`jose` HS256; claims are user,
   organization and session only) and then calls `resolveSession`, which ran **three sequential
   statements**, each its own pool checkout:
   1. session ⋈ user ⋈ organization ⟕ avatar;
   2. role grants;
   3. active properties with current business dates.
3. The rules applied in JavaScript:
   - The session must exist, not be revoked, not be expired, and match the claims.
   - The user and the organization must be ACTIVE.
   - A session opened before the last password change is dead.
   - Grant keys must be catalog permissions.
   - An organization grant (or super admin) reaches every active property; otherwise only the
     properties with property grants.
4. Nothing was cached.

**MEASURED on the benchmark database** (raw driver, per statement):

- Execution: 0.05–0.27 ms.
- Round trip: 0.6–1.3 ms.
- Planning: ≈1 ms for the three together.

**Finding.** `user_role_assignments` had **no index usable by `user_id` alone**. Both unique
indexes are partial on `property_id`, so the grants lookup scanned every assignment of every
organization. MEASURED with 100 000 assignments: 8.7 ms execution per authentication.

### 25.2 Change

1. **One statement** (`findSessionAccess`, `modules/access/access.repository.ts`). The same three
   reads are scalar subqueries of one SELECT keyed by the session id.
   - The grants subquery is the former query verbatim.
   - The properties subquery returns the user's reachable superset: super admin, any
     organization-scope assignment, or an assignment at that property.
   - `resolveSession` keeps every check and applies the exact property rule, so a property the
     grants do not reach can never appear.
   - A first version with a CTE was rejected: PostgreSQL planned it in 1.5–2.5 ms per call,
     slower than the three statements.
2. **Index `user_role_assignments_user_id_idx`.** Migration `20261201090000`, CONCURRENTLY.
3. **Nothing is cached.** Logout, disable, password change, session revocation, and role or
   permission changes all take effect on the very next request, as before. No short-lived cache
   was introduced: the measured gain did not need one, and no invalidation channel exists.

### 25.3 Before / after

MEASURED on the benchmark database (100 000 role assignments), production build, one instance,
closed model, 20 s per cell. A = previous code, B = one statement, Ai = previous code plus the
index, C = one statement plus the index (shipped).

| Request                      | Metric (16 users unless noted) |       A (before) |                B |              Ai |           C (after) |
| ---------------------------- | ------------------------------ | ---------------: | ---------------: | --------------: | ------------------: |
| `/me`                        | req/s                          |              178 |              187 |             265 |             **327** |
|                              | p50 / p95 / p99 ms             | 84.8 / 120 / 141 | 79.8 / 122 / 148 | 55.9 / 82 / 101 |  **45.6 / 68 / 85** |
|                              | auth p50 (Server-Timing)       |          67.7 ms |             55.2 |            44.2 |            **28.2** |
|                              | auth p50, **1 user**           |          11.7 ms |             14.4 |             4.0 |             **3.7** |
|                              | PostgreSQL CPU per request     |          7.41 ms |             6.71 |            0.86 |            **0.84** |
| business date (typical read) | req/s                          |              143 |              153 |             222 |             **241** |
|                              | p50 / p95 / p99 ms             |  106 / 147 / 175 |   99 / 138 / 169 |   69 / 94 / 108 |    **63 / 85 / 95** |
|                              | auth p50                       |          73.8 ms |             56.1 |            45.6 |            **30.1** |
| dashboard (permission-heavy) | req/s                          |               97 |               98 |             122 |             **131** |
|                              | p50 / p95 / p99 ms             |  155 / 210 / 273 |  154 / 203 / 272 | 124 / 159 / 207 | **116 / 147 / 189** |
|                              | auth p50                       |          54.9 ms |             41.8 |            35.7 |            **20.0** |

**Statements per request** (MEASURED by `tests/integration/request-overhead.test.ts` and
`session-resolution.test.ts`):

- Authentication: **3 → 1**.
- `/me`: 3 → 1.
- A property read such as business date: 4 → 2.

**Attribution:**

- The index removes the database cost: 7.4 → 0.86 ms of PostgreSQL CPU per `/me`.
- One statement removes queueing, i.e. fewer pool checkouts and Prisma calls. With the index in
  place, auth p50 under 16 users drops 44 → 28 ms and `/me` throughput rises 23%.
- One user sees little difference (4.0 → 3.7 ms): planning, not round trips, dominates there.

**Security semantics (MEASURED by tests):**

- A differential test compares the new resolver with the previous algorithm (reproduced in the
  test) for organization, property, mixed, two-property, super-admin and grant-less users, plus:
  - inactive properties;
  - other organizations' roles;
  - non-catalog permission keys;
  - system roles.
- A mutation (dropping the `status = 'ACTIVE'` filter) is caught.
- Expired token, deleted session, mismatched claims, inactive organization, a permission removed
  from a role and a lost organization grant are each rejected on the next request.
- Existing suites cover revocation on logout, refresh rotation and reuse, disable, password
  change and property-grant removal. All pass.

## 26. Shared rate limiting

### 26.1 Audit

- **Interface:** `RateLimitStore { hit(id, windowMs, now) → { count, resetAt }; clear() }` with
  `setRateLimitStore`. The only caller is `consumeRateLimit`, used by `lib/http/route.ts` (route
  limits and the pre-authentication write guard) and `identity.service`.

**Limits:**

| Rule                        | Limit / window   | Key   | On store failure |
| --------------------------- | ---------------- | ----- | ---------------- |
| `auth.login.ip`             | 20 / 1 min       | IP    | **deny**         |
| `auth.login.account`        | 10 / 15 min      | email | **deny**         |
| `auth.password.reset.ip`    | 10 / 1 min       | IP    | **deny**         |
| `auth.password.reset.issue` | 10 / 1 h         | user  | **deny**         |
| `auth.password.change`      | 5 / 15 min       | user  | **deny**         |
| `auth.refresh.ip`           | 60 / 1 min       | IP    | **deny**         |
| `api.write.ip`              | 300 / 1 min      | IP    | allow            |
| `availability.central`      | 60 / 1 min       | user  | allow            |
| `reports.run` / `.export`   | 120 / 30 per min | user  | allow            |
| `billing.write`             | 120 / 1 min      | user  | allow            |
| `groups.pickup`             | 120 / 1 min      | user  | allow            |
| `nightaudit.start`          | 10 / 1 min       | user  | allow            |
| `me.avatar`                 | 20 / 15 min      | user  | allow            |

Account lockout (5 failures, database row lock, D45) was already global and is unchanged.

**Before (in process memory; ESTIMATED from the round-robin behaviour, MEASURED at 2 and 4
instances).** With N instances, each limit allowed up to N× its budget. For per-account sign-in
attempts per 15 min:

| Instances | 1   | 2   | 10  | 50  | 100   |
| --------- | --- | --- | --- | --- | ----- |
| Allowed   | 10  | 20  | 100 | 500 | 1 000 |

Counters also reset on every deploy or restart.

### 26.2 Options compared

| Option                                 | Latency per hit         | Atomicity                           | Horizontal scaling                                                    | Failure behaviour                   | Operations                               |
| -------------------------------------- | ----------------------- | ----------------------------------- | --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| Process memory (before)                | µs                      | per process only                    | **wrong**: N× limits                                                  | none                                | none                                     |
| **PostgreSQL table** (chosen)          | 0.6 ms p50 (MEASURED)   | row lock of `ON CONFLICT DO UPDATE` | ~5–7K hits/s from one client here (MEASURED); scales with the primary | same fate as the app's own database | none new; one table, pruned by retention |
| Redis (`INCR` + `EXPIRE`)              | ~0.2–0.5 ms (ESTIMATED) | atomic commands                     | 100K+ ops/s                                                           | separate failure domain             | new service and dependency, HA to run    |
| Load balancer / gateway limits (nginx) | none                    | per node                            | per node, IP keys only                                                | —                                   | cannot key by account or user            |

**Chosen:** PostgreSQL. It is already the system's dependency, so an outage of the store is an
outage of the app. It is atomic, and there is no new service or dependency. Only rate-limited
requests touch it: writes, sign-in, refresh, reset, availability, reports; ordinary reads do not.

**PROPOSED:** revisit Redis when rate-limited requests approach a few thousand per second per
primary, or when the primary's write load needs relief.

### 26.3 Implementation

- **Table `rate_limit_windows`** (`key` PK, `count`, `reset_at`, index on `reset_at`).
  - Migration `20261201090100`, `UNLOGGED`: no WAL for short-lived counters. It is emptied after
    a crash and not copied to physical replicas, so windows restart; accepted.
  - Expired rows are pruned by `ops:maintenance` (target `rateLimitWindows`, 1 day).
- **`PostgresRateLimitStore`** (`lib/db/rate-limit-store.ts`). One statement:
  `INSERT … ON CONFLICT (key) DO UPDATE SET count = CASE WHEN reset_at <= now THEN 1 ELSE count + 1 END, …
RETURNING count, reset_at`.
  - **Atomicity:** the conflicting row is locked for the update, so concurrent hits from any
    instance are serialised and each sees a distinct count.
  - **Clock:** windows use the caller's clock, as before. Instance skew of milliseconds does not
    matter to minute-long windows.
  - **Long keys:** keys over 400 characters are stored as a SHA-256.
- **Selection.** Default store PostgreSQL (`RATE_LIMIT_STORE=postgres`); `memory` is for single
  processes only (unit tests).
- **Failure policy** (per rule, `onStoreFailure`):
  - **deny:** every `auth.*` rule (sign-in by IP and account, reset completion and issuance,
    password change, refresh). A store failure answers 500 "temporarily unavailable" and never
    admits unthrottled guessing.
  - **allow** (default): everything else. The request is served unlimited, and the failure is
    logged once per minute per rule, so an abuse brake cannot take the application down.
  - Both paths are logged without request data.
- **Tests' client addresses** start at a random offset per worker. Parallel test files now share
  the store, just as production instances do.

### 26.4 Measurements

**Store (MEASURED, bench database, raw driver):**

- One hit: p50 0.60 ms, p95 0.89, p99 1.05.
- 10 connections: 4 886 hits/s with distinct keys, 6 869 hits/s on one hot key.
- **10 000 concurrent increments on one key produced count 10 000, with no lost updates.**

**Request overhead (MEASURED, one instance, 8 users closed, 20 s, memory store → shared store):**

| Request                            | memory     | shared     | Note                                                                  |
| ---------------------------------- | ---------- | ---------- | --------------------------------------------------------------------- |
| guest note (write, `api.write.ip`) | 64.5 req/s | 67.6 req/s | no measurable cost (within noise)                                     |
| failed sign-in                     | 96.8 /s    | 89.8 /s    | two limit hits (IP, account) plus argon2 (−7%)                        |
| successful sign-in                 | 64.7 /s    | 54.0 /s    | argon2-bound; −17%, of which the two 0.6 ms statements explain little |
| password-reset attempt             | 424 /s     | 295 /s     | cheapest request: one extra statement is −30% (p50 17.5 → 25.7 ms)    |

**Horizontal (MEASURED, 1/2/4 `next start` instances on this laptop):**

- One unknown account got 14 wrong-password attempts, alternating instance and client address.
- `/me` used 32 users across the instances, round-robin.

| Instances | Shared store: allowed before 429 | Memory store: allowed before 429 | `/me` req/s (shared / memory) |
| --------: | -------------------------------- | -------------------------------- | ----------------------------- |
|         1 | **10**                           | 10                               | 333 / 294                     |
|         2 | **10**                           | 14 of 14 (never limited)         | 464 / 455                     |
|         4 | **10**                           | 14 of 14 (never limited)         | 487 / 476                     |

- **Switching instances never reset the budget.** It also survived restarts: re-running the
  benchmark's own sign-ins within 15 minutes met the account limit (429), which the memory store
  forgot on every restart.
- `/me` scaling flattens at 4 instances because this 4-core laptop runs out of CPU (§17).

**Browser QA (MEASURED; production build behind TLS, headless Chrome):**

- Normal sign-in, navigation and property switching SDX ↔ SMR and to `/organization` work.
- Five wrong passwords give the generic message and lock the account; the correct password is
  refused while locked. After the lock expires sign-in succeeds and the failure count resets.
- A disabled user gets 401 on the next API request, is sent to `/login` on navigation, and
  cannot sign in.
- After a password change the current browser continues, another device's session gets 401, the
  old password fails and the new one works.
- Sign-out clears the cookie and the old token gets 401.
- With the access cookie removed, the session is silently restored by the refresh token.
- No console errors.

## 27. Remaining bottlenecks after phase 2

Unchanged from §20, minus the two items this phase removed:

- **ESTIMATED:** authentication is now one indexed statement (≈0.8 ms PostgreSQL CPU per request
  here). The per-request floor is the Next.js framework (≈1.5 ms CPU) plus the handler's own SQL.
- Rate limits are now correct at any instance count. Their database load is one statement per
  rate-limited request.
- **Still open:**
  - polling (the busiest screens done in §31);
  - global search (done in §28);
  - the single primary and connection pooling (PgBouncer; the new store works through a
    transaction pooler, since it is one autocommit statement);
  - synchronous night audit and reports;
  - a production-like test environment.
- **Not claimed:** 100 000 requests per second.

## 28. Unified global search

The palette (Ctrl/Cmd+K) used to send **six authenticated requests per debounced keystroke**, one per
record type, and three more when it opened (room picker, room board and rate plans, ≈160 KB), which it
then filtered in the browser. Now it sends **one** request per debounced query:

- `GET /api/v1/properties/{id}/search?q=` for the property workspace;
- `GET /api/v1/search?q=` for the organization workspace (guest and company profiles).

### 28.1 Audit of the former sources

| Type         | Endpoint                                  | Permission                                                 | Scope                                         | Query (limit 5)                                                                                                 | Before p50, 1 user           |
| ------------ | ----------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Reservations | `properties/{id}/reservations?q=`         | `reservations:read` at P                                   | property                                      | OR of confirmation, cancellation number, external reference, room and guest-name tokens; ordered by arrival, id | 60 ms                        |
| Guests       | `guests?q=`                               | `guests:read` anywhere; UI: at P                           | organization, facts from permitted properties | trigram `search_name`, confirmation through permitted properties                                                | 205 ms                       |
| Folios       | `properties/{id}/folios?view=all&q=`      | `billing:read` at P                                        | property                                      | name, confirmation or room; ordered by guest name, id                                                           | **410 ms** (758 ms for "al") |
| Companies    | `accounts?q=`                             | `accounts:read` anywhere; UI: at P                         | organization                                  | normalized name or code                                                                                         | 27 ms                        |
| Groups       | `properties/{id}/groups?q=`               | `groups:read` at P                                         | property                                      | code or name                                                                                                    | 28 ms                        |
| Maintenance  | `properties/{id}/maintenance?view=all&q=` | `maintenance:read` at P                                    | property                                      | number, title, room                                                                                             | 30 ms                        |
| Rooms        | picker + board, filtered in the browser   | `rooms:read` and (`housekeeping:read` or `frontdesk:read`) | property                                      | every word in number or room type code                                                                          | on open                      |
| Rate plans   | `rate-plans`, filtered in the browser     | `rates:read`                                               | property                                      | every word in code or name                                                                                      | on open                      |

No source depends on another. The browser waited for all six (`Promise.all`), so the slowest one, folio
search, set the latency.

### 28.2 Changes

- **One endpoint per workspace** (`modules/search`).
  - The route authenticates once. The service includes a type only when the caller holds its read
    permission. For the property search that is at P, exactly as the palette gated it; rooms also need
    a board to open on.
  - Each type runs through its own existing service, with its own query schema, limit 5, scope and
    order. Search semantics are unchanged.
  - Groups come back in a fixed order, with no empty groups, at most 5 per type and 40 in total.
  - A type that fails is omitted and logged, as the palette omitted it.
- **Normalized results.**
  - Each result has: `type`, `id`, `title`, `subtitle`, `meta`, `vip`, `propertyCode`, `targetId`, and
    `roomView` for rooms.
  - The server never sends a URL. The palette builds the route from the type (`searchResultRoute`:
    well-formed property code and UUID, fixed templates). It opens the route only when the property is
    one of the user's own.
  - The displayed fields are those the palette showed before. Folio balances appear only with
    `billing:read`.
- **Rooms and rate plans moved to the server.**
  - Each is one statement: `findRoomsForSearch` in raw SQL, and `findRatePlansForSearch` without the
    list's relations.
  - The previous word-matching rule (`lib/utils/text-match.ts`) is applied to the result.
  - With Prisma relation selects they had cost 3 and 6 statements.
- **Folio search** (`findFolioListPage`).
  - Guest name, confirmation and room number are now separate branches. Each takes its own first page
    in list order (guest name, id); the page is cut from their union.
  - This returns the same rows as filtering on the OR and cutting once, and each branch can use its
    index. Before, the OR across three tables scanned the property's reservation rooms.
  - Verified identical on 144 recorded cases (every view, 12 terms, 2 page sizes, 2 pages, cursors).
  - Standalone timings: khan 287 → 119 ms; "al" 1077 → 159 ms. No new index.
- **Client.**
  - A lazy RTK Query sends one request per 200 ms debounced text. Leaving that text cancels the
    request in flight (`AbortController`); the same text never starts a second one, and a cached text
    starts none.
  - A response is shown only if it answers the text and property on screen (`isCurrentSearch`).
  - Loading, empty and error states (with retry). Keyboard navigation and visuals are unchanged.
- **Concurrency.**
  - A search runs at most `SEARCH_CONCURRENCY` types at a time (default 3; slowest types first).
  - One request therefore holds at most 3 of the pool's connections.
- **`Server-Timing`** (opt-in `SERVER_TIMING=1`) adds `search-<type>;dur=` for each type.

### 28.3 Measurements

Setup:

- The benchmark database of §4.
- One `next start` production instance, with `SERVER_TIMING=1`.
- k6 at 1/8/16/32 virtual users, 20 s per run, no think time.
- Two search terms: `khan` (typical) and `al` (broad).
- "Before" is the build of §25–27. PostgreSQL CPU comes from performance counters; per-search values
  divide its average by the search rate.

**MEASURED**, one search = one debounced keystroke:

| Case                  | Req/search | Searches/s | p50     | p95  | p99  | PG CPU ms/search | Errors |
| --------------------- | ---------- | ---------- | ------- | ---- | ---- | ---------------- | ------ |
| before khan, 1 user   | 6          | 2.4        | 411     | 506  | 568  | 144              | 0      |
| after khan, 1 user    | **1**      | 6.5        | **147** | 194  | 200  | 113              | 0      |
| before al, 1 user     | 6          | 1.2        | 758     | 971  | 1021 | 267              | 0      |
| after al, 1 user      | 1          | 4.3        | 219     | 284  | 314  | 136              | 0      |
| before khan, 8 users  | 6          | 4.1        | 1884    | 2507 | 2979 | 402              | 0      |
| after khan, 8 users   | 1          | 12.7       | 576     | 998  | 1140 | 186              | 0      |
| after al, 8 users     | 1          | 9.3        | 828     | 1162 | 1364 | 318              | 0      |
| before khan, 16 users | 6          | 3.9        | 3864    | 4988 | 5785 | —                | 0      |
| after khan, 16 users  | 1          | 12.2       | 1239    | 1690 | 1873 | 307              | 0      |
| before khan, 32 users | 6          | 4.1        | 7657    | 9714 | 9751 | —                | 6.6 %  |
| after khan, 32 users  | 1          | 12.3       | 2578    | 2861 | 3056 | 169              | 0      |

- Palette open: 3 requests (≈160 KB) → 0.
- Pool: at most 11–15 PostgreSQL connections at every load (pool 10 plus the monitor's).

Where the gain comes from: the old six-request fan-out, run against the new build (the folio fix
included), gives:

| Case           | Searches/s | p50  | p95  | p99  | App CPU ms/search |
| -------------- | ---------- | ---- | ---- | ---- | ----------------- |
| khan, 1 user   | 5.9        | 157  | 214  | 249  | 11.5              |
| khan, 8 users  | 11.4       | 641  | 1099 | 1363 | 42.9              |
| khan, 32 users | 11.3       | 2798 | 3006 | 3364 | 34.7              |

- **Most of the latency** came from the folio query.
- **Unification** gives:
  - 6× fewer HTTP requests, and 5 fewer authentication statements per search;
  - no preloads when the palette opens;
  - ≈40 % less application CPU per search (25 vs 43 ms at 8 users);
  - ≈10 % more throughput at saturation.

**DB statements per search, MEASURED** (integration fixture, `countStatements`):

- Six requests: 29 statements.
- Unified: 26 statements. That is the same six searches minus five authentications, plus one
  statement each for rooms and rate plans.

**Sequential vs hybrid vs parallel, MEASURED** (`SEARCH_CONCURRENCY` 1 / 3 / 8):

| Users, term                      | 1 (sequential)     | 3 (hybrid, chosen) | 8 (parallel)       |
| -------------------------------- | ------------------ | ------------------ | ------------------ |
| 1, khan: p50 / searches/s        | 214 ms / 4.2       | 147 ms / 6.5       | 154 ms / 6.1       |
| 1, al: p50                       | 240 ms             | 219 ms             | 222 ms             |
| 8, khan: p50 / p95 / searches/s  | 682 / 986 / 12.0   | 576 / 998 / 12.7   | 599 / 993 / 12.6   |
| 32, khan: p50 / p95 / searches/s | 2146 / 3351 / 13.8 | 2578 / 2861 / 12.3 | 2644 / 3104 / 11.7 |

- Sequential adds the types' times together at low load, where the palette is used.
- Fully parallel takes up to 8 pool connections per keystroke, starving other requests, for no latency
  gain over 3.
- 3 has the best low-load latency and the best p95 at saturation.

**Correctness, MEASURED:**

- The unified results were compared field by field with what the old palette showed, using the old
  client mapping on recorded responses: 26 property/term cases, 228 hits, 0 differences.
- Folio list: 144/144 recorded cases identical.

### 28.4 Security

- Integration tests (`tests/integration/global-search.test.ts`) cover:
  - type gating per property and split permissions;
  - multi-property scoping, checked against the rows' `property_id`;
  - organization routing to a permitted property;
  - no permitted type (empty groups);
  - cross-organization;
  - an inaccessible property (403);
  - anonymous, forged, signed-out and disabled sessions (401);
  - limits, deterministic order, normalization, routes;
  - equality with the per-type endpoints.
- Unit tests (`tests/unit/search-policy.test.ts`) cover:
  - route templates;
  - rejected codes and ids (path traversal, open redirect, unknown types);
  - the stale-response guard.

### 28.5 Browser QA (production build behind the local TLS proxy, bench database)

- **Organization GM, property workspace:**
  - One request per debounced query: rapid "khan" gave 1 request.
  - Slow typing gave one request per pause; a text already cached gave none.
  - Opening the palette sent no preload.
  - Arrow keys and Enter work. Reservation, room, folio, company and group results open their pages.
  - Empty results show the empty state.
- **Slow network (1.5 s):**
  - "zhang" then "khan": the "zhang" request was cancelled, and its results never appeared.
- **Offline:**
  - "Search is unavailable" appears, with a retry that succeeds after reconnecting.
- **Property switch:**
  - The request goes to the other property.
- **Organization workspace:**
  - Guests only, opening in the lowest permitted property.
- **Multi-property GM (SDX and SMR):**
  - Each workspace is scoped to its property; organization guests open in SDX.
- **Front desk agent (SMR only):**
  - Searching SDX directly: 403.
- **Housekeeper (SDX):**
  - The hint lists rooms only; "khan" finds nothing, "101" finds rooms.
- **Sign-out during a search:**
  - The next keystroke gets 401, the refresh fails, and the app redirects to `/login?next=…`.
- **Console:**
  - No application errors. The only entries are the browser's network logs of the deliberate
    offline, 403 and 401 cases.

### 28.6 Remaining

- **MEASURED, pre-existing:** reservation search takes ≈1.9 s for a text that matches nothing
  (`zzqxv`, 400k reservation rooms).
  - Its OR across confirmation, room and guest name, ordered by arrival with `LIMIT 6`, walks the
    property's whole history when nothing matches. It stops early for common texts.
  - The unified search waits for it, as the old palette did.
  - Done in §29: the per-branch top-N rewrite used for folios, with the same record-and-compare check.
- **ESTIMATED:** at saturation this instance does ≈12 searches/s. Search is bounded by PostgreSQL work
  on 400k-row histories, not by request count.
- **Not claimed:** 100 000 requests per second.

## 29. Reservation search

### 29.1 Path and root cause

The path is:
Reservations screen (URL-synced `q`, `state`, date ranges, room type, source, `sort`) →
`GET /properties/{id}/reservations` (`reservations:read`, property from the path) → `listReservations` →
`findReservationRoomsPage` → one Prisma `findMany`.

With `q`, the service added one OR to the filters:

- confirmation prefix and, for bare digits, `-<digits>` contained;
- cancellation number;
- external reference;
- room number;
- every guest-name word.

Prisma compiles each relation filter into its own join: `reservations` twice, `rooms` and `guests`. The OR
can only be tested after those joins, and no index serves an OR across four tables. So PostgreSQL walked the
property's reservation rooms in the sort order (`property_id, arrival_date` index), joined every row four
times, and stopped only when the page was full.

- For a text matching many rows, that is early.
- For a text matching few or no rows, that is the whole history: **203,794 rows** at SMR.

**MEASURED plans** (EXPLAIN ANALYZE of the page statement, SMR, `limit` 25; case 9 is the Global Search shape
with `limit` 5):

| Case                  | Before: execution | Before: buffers | After: execution (all branches) | After: buffers |
| --------------------- | ----------------- | --------------- | ------------------------------- | -------------- |
| 1 no match (`zzqxv`)  | 3,395 ms          | 3,250,104       | 0.6 ms                          | 25             |
| 2 exact confirmation  | 7,509 ms          | 4,065,452       | 5.4 ms                          | 192            |
| 3 guest name (`khan`) | 255 ms            | 55,124          | 16.4 ms                         | 5,686          |
| 4 room number         | 475 ms            | 355,325         | 20.8 ms                         | 6,989          |
| 5 broad (`al`)        | 8.5 ms            | 5,955           | 3.0 ms                          | 1,876          |
| 6 + arrival range     | 25 ms             | 18,212          | 10.6 ms                         | 5,713          |
| 7 + state             | 159 ms            | 53,731          | 7.2 ms                          | 5,686          |
| 8 second page         | 154 ms            | 61,366          | 14.2 ms                         | 10,198         |
| 9 no match, `limit` 5 | 2,543 ms          | 3,250,101       | 0.2 ms                          | 22             |

After the change:

- a rare pair of common name words (`ahmed zhang`, `limit` 5) executes in 6 ms; in the intermediate version
  of the change it took 617 ms and read 1.0M buffers;
- two-letter texts that match nothing (`zz`, `qx`) execute in 76–90 ms. The trigram index cannot serve
  words under 3 characters.

### 29.2 Change (`listReservations`, `findReservationRoomsPageMatching`)

- **One query per kind of match.** Each OR arm runs as its own `findMany`, with the same filters, cursor,
  sort, and `limit + 1`. Each selects only the id and the sort keys.
  - The page is cut from the union: merge in (sort key, id) order, drop duplicates, keep `limit + 1`.
  - A final query loads those rows with the existing select.
  - This is the same page as the single OR query: the first N rows of a union are always among the first
    N rows of its parts, and (sort key, id) is a total order.
  - Filters, cursor semantics, fields and `nextCursor` are unchanged. The filters stay in the same Prisma
    `where`, not re-implemented in SQL.
  - The branches run one after another. Running them at once was measured (§29.5): no gain under load,
    and more pool connections per request.
- **Room number.** The room is looked up first (`rooms(property_id, number)` is unique), and the branch
  becomes `room_id = …`. A number that is no room adds no branch.
  - As a filter on the joined room, a missing room made the planner walk the whole history (183 ms,
    204k buffers at `limit` 5).
- **Guest name.** Guests passing the same `contains` filters are looked up first (trigram index, at most
  501):
  - none → no branch;
  - ≤ 500 → `primary_guest_id IN (…)` (primary-guest index);
  - more → the former relation filter. The walk in sort order meets matches early when they are that
    common.
  - Words shorter than 3 characters cannot use the trigram index. The lookup would read the whole index
    (160–230 ms), so they keep the relation filter.
  - The lookup costs 1.3–2.6 ms, including common words (`ahmed`: 17,250 guests).
- **No new index.** Every branch uses an existing index:
  - trigram on `reservations.confirmation_number` and `guests.search_name`;
  - `reservation_rooms(property_id, cancellation_number)`, `(property_id, room_id)`, `(primary_guest_id)`;
  - `reservations(property_id, external_reference)`;
  - `rooms(property_id, number)`.
- **Statements.** With text there are up to 18 instead of 12: the room and guest lookups, up to 4–5
  branches, and the page load. With no match there are 6 instead of 11. Without text the path is
  unchanged.

### 29.3 Result equivalence (MEASURED)

- **Recorded API responses** (bench database, before vs after):
  - 984 cases, 1,641 pages, 18,309 rows: **984/984 identical** (items, order, fields, cursors, statuses);
  - 18 terms × 3 sorts × 9 filter sets × 2 properties × page sizes 5/20, each followed through its cursor
    for up to 3 pages;
  - terms: no match, names, words in either order, `o'`, `__`, a 1-character text (400), confirmation full,
    prefix and suffix, a multi-room confirmation, `PREFIX-number`, room, digits.
  - Filter sets: states, arrival, departure and created ranges, room type + source, channel, guest.
- **Integration oracle** (`tests/integration/reservation-search.test.ts`):
  - Every page chain is compared with the former single query, run directly: 19 terms × 4 filters ×
    3 sorts × page sizes 2/5/50 = **684 full pagination chains, identical**.
  - Both name strategies are covered (a surname shared by 520 guests), as are short texts, cancellation
    numbers and external references (none exist in the bench data).

### 29.4 Security

- Integration tests cover:
  - cross-property and cross-organization isolation for every kind of match;
  - another organization's property (403);
  - single-property, multi-property and organization-wide users;
  - no `reservations:read` (403);
  - anonymous, signed-out and disabled sessions (401);
  - an inactive property (403).
- Existing suites (reservations, filters, global search, multi-property, RBAC isolation, front desk):
  119/119 passed.

### 29.5 Load (MEASURED; one `next start` instance, k6 `reservationSearch` class with `limit` 20, 20 s runs, fixed term, alternating SMR/SDX)

| Term                  | Users | Before searches/s | Before p50 / p95 / p99 (ms) | Before errors | After searches/s | After p50 / p95 / p99 (ms) | After errors | PG CPU ms/search before → after |
| --------------------- | ----- | ----------------- | --------------------------- | ------------- | ---------------- | -------------------------- | ------------ | ------------------------------- |
| no match `zzqxv`      | 1     | 0.3               | 3227 / 3469 / 3517          | 0             | 80.3             | 12 / 15 / 18               | 0            | 461 → 1.6                       |
|                       | 8     | 0.7               | 7825 / 25370 / 26328        | 0             | 169.8            | 45 / 57 / 67               | 0            | 6147 → 2.7                      |
|                       | 16    | 0.9               | 14733 / 22448 / 26365       | 30 %          | 183.2            | 84 / 103 / 147             | 0            | 5546 → 2.4                      |
|                       | 32    | 2.5               | 6928 / 21801 / 24917        | 86.5 %        | 179.4            | 167 / 240 / 312            | 0            | 1997 → 2.8                      |
| confirmation `276374` | 1     | 0.2               | 4843 / 5398 / 5406          | 0             | 48.4             | 19 / 26 / 32               | 0            | 1622 → 2.9                      |
|                       | 8     | 0.4               | 13307 / 15849 / 20912       | 0             | 107.8            | 71 / 90 / 106              | 0            | 9433 → 6.2                      |
|                       | 16    | 1.5               | 5175 / 15531 / 22691        | 55.8 %        | 105.3            | 146 / 182 / 196            | 0            | 3218 → 6.9                      |
|                       | 32    | 3.5               | 5231 / 18689 / 18769        | 89.8 %        | 102.5            | 292 / 403 / 473            | 0            | 1523 → 6.6                      |
| name `khan`           | 1     | 5.0               | 187 / 274 / 303             | 0             | 24.3             | 38 / 55 / 67               | 0            | 65 → 11                         |
|                       | 8     | 39.9              | 84 / 601 / 760              | 0             | 61.2             | 125 / 159 / 198            | 0            | 36 → 34                         |
|                       | 16    | 46.8              | 241 / 839 / 1008            | 0             | 56.2             | 273 / 350 / 376            | 0            | 44 → 40                         |
|                       | 32    | 48.9              | 563 / 1072 / 1227           | 0             | 57.8             | 533 / 629 / 651            | 0            | 33 → 40                         |
| broad `al`            | 1     | 37.1              | 25 / 33 / 38                | 0             | 44.0             | 22 / 28 / 34               | 0            | 5.8 → 4.4                       |
|                       | 8     | 75.9              | 100 / 132 / 154             | 0             | 72.2             | 106 / 139 / 156            | 0            | 15.8 → 9.2                      |
|                       | 16    | 76.9              | 202 / 253 / 277             | 0             | 72.0             | 214 / 262 / 275            | 0            | 18.2 → 8.6                      |
|                       | 32    | 76.2              | 401 / 495 / 560             | 0             | 77.0             | 405 / 453 / 481            | 0            | 19.6 → 8.3                      |

- Before, the errors were pool connection timeouts: searches that walked the history held the 10
  connections past the 5 s connect timeout. PostgreSQL CPU was pinned at ≈5 cores.
- After, peak PostgreSQL CPU was under 2.4 cores in every run.
- **Broad texts** stay within run-to-run noise (±5 %), with lower PostgreSQL CPU.
- **`khan` at 8 users:** p50 is higher (84 → 125 ms), but p95 is 601 → 159 ms and throughput is +53 %.
- **Branches at once** (6 in flight), measured and not adopted:
  - `khan` at 32 users: 57.8 → 60.8 searches/s;
  - `al` at 32 users: 77.0 → 84.1 searches/s;
  - Global Search `khan` at 8 and 32 users: unchanged (655 → 658 ms, 2940 → 2975 ms);
  - it only helps a single user.

**Global Search** (`unifiedSearch`, MEASURED):

| Term     | Users | Before searches/s | Before p50 / p95 / p99 (ms) | Before errors | Before reservations p50 | After searches/s | After p50 / p95 / p99 (ms) | After errors | After reservations p50 |
| -------- | ----- | ----------------- | --------------------------- | ------------- | ----------------------- | ---------------- | -------------------------- | ------------ | ---------------------- |
| no match | 1     | 0.4               | 2310 / 2501 / 2502          | 0             | 2297 ms                 | 40.7             | 23 / 31 / 38               | 0            | 8 ms                   |
|          | 8     | 0.8               | 5712 / 21288 / 21289        | 0             | 5693 ms                 | 64.8             | 118 / 152 / 183            | 0            | 82 ms                  |
|          | 32    | 2.3               | 9667 / 25379 / 30295        | 7.3 %         | 5068 ms                 | 65.6             | 467 / 556 / 604            | 0            | 379 ms                 |
| `khan`   | 1     | 5.5               | 171 / 244 / 263             | 0             | 26 ms                   | 5.2              | 183 / 219 / 245            | 0            | 61 ms                  |
|          | 8     | 11.9              | 608 / 1017 / 1201           | 0             | 315 ms                  | 11.8             | 655 / 996 / 1269           | 0            | 503 ms                 |
|          | 32    | 11.6              | 2712 / 3133 / 3310          | 0             | 2176 ms                 | 10.4             | 2940 / 3353 / 3402         | 0            | 2656 ms                |
| `al`     | 1     | 3.8               | 258 / 306 / 351             | 0             | 18 ms                   | 3.7              | 258 / 314 / 340            | 0            | 22 ms                  |
|          | 8     | 9.0               | 833 / 1243 / 1351           | 0             | 38 ms                   | 9.1              | 826 / 1259 / 1407          | 0            | 41 ms                  |
|          | 32    | 9.8               | 3195 / 3736 / 4295          | 0             | 2718 ms                 | 9.3              | 3391 / 3905 / 4044         | 0            | 3146 ms                |

- The reservation type no longer dominates a no-match search.
- For `khan` and `al`, Global Search is bound by guests and folios (§28). Its totals stay within the
  run-to-run spread measured in §28.3: 576–617 ms at 8 users and 2578–2970 ms at 32 users for `khan`.

### 29.6 Browser QA (production build behind the local TLS proxy, bench database)

- **Organization GM on the Reservations screen:**
  - Every screen showed the API's own rows: normal search, no match (empty state), confirmation (1 row,
    no "Load more"), two-word name, room, arrival range, state, and combined filters with sort.
  - Typing plus Search updates the URL.
  - "Load more" twice gives 150 unique rows.
  - SDX after switching property shows SDX results.
- **Global Search:**
  - Reservation results appear and open.
  - A no-match text shows "No results" 328 ms after typing (the 200 ms debounce included).
- **Other users:**
  - A multi-property GM gets both properties.
  - A front desk agent (SMR only) gets "Access denied" on SDX, and a 403 from the API.
  - A housekeeper (no `reservations:read`) gets "Access denied" and a 403.
- **Console:** no application errors; only the browser's logs of those two deliberate 403 probes.

### 29.7 Remaining

- **ESTIMATED:** at saturation this instance serves 100–180 reservation searches/s for selective texts
  and 55–80 for common ones. The limit is now Prisma relation loads (≈9 statements for the page) and the
  Next.js event loop, not PostgreSQL.
- **PROPOSED:**
  - Load the page's relations in one statement (done in §30).
  - Global Search for common texts is bound by guests and folios (§28).
- **Not claimed:** 100 000 requests per second.

## 30. Reservation list page loading

### 30.1 Before (MEASURED)

A reservation list page cost **12 statements** after authentication:

- the page query, via Prisma with `listSelect`;
- nine relation loads, one per relation (reservation type, guest, reservation, channel, the reservation's
  rooms, source code, room type, rate plan, room);
- the totals aggregate;
- the currency lookup.

A text search with results cost 17–18 statements, since its final page load was the same. The list
endpoint saturated at ≈81 requests/s with PostgreSQL at ≈0.5 cores: the time went to round trips and
Prisma, not to the database.

### 30.2 Change (`listReservations`, `findReservationRoomPageKeys`, `findReservationListRows`)

- **Keys first.** The page is selected as before, with the same `where`, `orderBy` and `limit + 1`, or
  the text-search branches of §29. Only the id and sort keys are read; the cursor is built from them as
  before.
- **Then one statement** loads those rows (`rr.id IN (…)` and the property) in the same order (sort key,
  then id). It returns every field the list shows:
  - the codes: reservation type, channel, room type, room, rate plan, source;
  - the reservation's room count;
  - the stay total (sum of night rates);
  - the currency's minor units, with the same fallback of 2.
- **Scalar subqueries, not joins, for the codes.** Measured on 50 rows, median of 30 runs, identical
  rows:
  - a nine-table join: 11.3 ms planning + 1.9 ms execution;
  - reservations and guests joined, codes as subqueries: 1.3 + 3.1 ms;
  - joining room types as well: 1.6 + 2.8 ms;
  - passing ids as one array instead of a list: no difference.
  - Prisma's statements are not prepared, so the join was planned on every request. The first build with
    joins raised PostgreSQL CPU per list request from 6.4 to 22.5 ms.
- **Mapping.** The response mapping is unchanged apart from reading the new column names. An empty page
  skips the load entirely, including the currency lookup.
- **Not used:** Prisma's `relationJoins` is still a preview feature in 7.10, and enabling it switches
  every query in the application to join loading.
- **No new index, no migration.**

**Statements per request, MEASURED** (in-process capture on the bench data):

| Case                          | Before | After |
| ----------------------------- | ------ | ----- |
| List page, any sort or filter | 12     | 2     |
| Text search with results      | 17–18  | 6–7   |
| Text search without results   | 6      | 5     |

Each figure excludes the one authentication statement. The integration test pins the list page at 3
including authentication.

### 30.3 Equivalence (MEASURED)

- **Recorded API responses, bench data:** 1,080 cases, 1,869 pages, 23,697 rows, **1,080/1,080
  identical** (items, field order, totals, cursors, statuses).
  - They cover 18 texts and no text × 3 sorts × 9 filter sets × 2 properties × page sizes 5/20/50, with
    up to 3 pages each.
  - The §29 recording (984 cases) is also still identical.
- **Integration oracle** (`reservation-search.test.ts`):
  - Every page is compared with the former relation selects, totals aggregate, currency lookup and
    mapping: 6 texts × 3 filters × 3 sorts × page sizes 3/50, every page, identical.
  - The fixture covers assigned and unassigned rooms, a multi-room booking and a cancellation.
  - The statement count is asserted.

### 30.4 Load (MEASURED; one `next start` instance, 20 s runs)

**List** (`reservationList`, 50 rows, no text):

| Users | Before req/s | Before p50 / p95 / p99 (ms) | Before PG CPU ms/req | Before active conn max/avg | After req/s | After p50 / p95 / p99 (ms) | After PG CPU ms/req | After active conn max/avg |
| ----- | ------------ | --------------------------- | -------------------- | -------------------------- | ----------- | -------------------------- | ------------------- | ------------------------- |
| 1     | 54.7         | 18 / 22 / 25                | 4.8                  | 6 / 0.6                    | 60.9        | 15 / 21 / 25               | 1.6                 | 1 / 0.6                   |
| 8     | 83.6         | 92 / 114 / 141              | 6.6                  | 5 / 1.0                    | 133.4       | 57 / 73 / 84               | 4.8                 | 5 / 2.0                   |
| 16    | 80.6         | 192 / 244 / 263             | 6.8                  | 5 / 1.3                    | 133.3       | 114 / 160 / 187            | 4.1                 | 6 / 2.0                   |
| 32    | 80.9         | 377 / 494 / 567             | 6.4                  | 5 / 1.1                    | 132.1       | 229 / 300 / 357            | 4.1                 | 5 / 1.8                   |

**Name search** (`reservationSearch`, `khan`, 20 rows):

| Users | Before req/s | Before p50 / p95 / p99 (ms) | Before PG CPU ms/req | Before active conn max/avg | After req/s | After p50 / p95 / p99 (ms)  | After PG CPU ms/req | After active conn max/avg |
| ----- | ------------ | --------------------------- | -------------------- | -------------------------- | ----------- | --------------------------- | ------------------- | ------------------------- |
| 1     | 24.1         | 40 / 48 / 53                | 13.4                 | 4 / 0.8                    | 25.3        | 37 / 48 / 61                | 6.5                 | 1 / 0.9                   |
| 8     | 58.8         | 131 / 162 / 174             | 34.6                 | 5 / 3.2                    | 70.5–75.8   | 102–109 / 124–138 / 140–159 | 41.7–43.3           | 8 / 3.9                   |
| 16    | 58.2         | 261 / 338 / 450             | 39.5                 | 8 / 3.2                    | 75.6        | 203 / 262 / 303             | 46.5                | 8 / 4.6                   |
| 32    | 59.7         | 520 / 612 / 684             | 36.4                 | 7 / 3.3                    | 73.5–75.5   | 408–411 / 494–529 / 570–620 | 44.8–47.0           | 8–10 / 4.4–4.5            |

- No errors in any run. The pool (10) was never exhausted.
- **List:** +63 % throughput, −39 % p50 and −39 % p95 at 32 users, with less PostgreSQL CPU per request.
- **Name search:** +23–29 % throughput and lower p50/p95/p99 at every load from 8 users. PostgreSQL CPU
  per search is **higher** at 8–32 users (35–40 → 42–47 ms, repeated runs), while PostgreSQL stays under
  3.5 of 8 cores. It is lower at 1 user.
  - ESTIMATED: the name branch of §29 dominates this text (≈5.7k buffers a search). More of them run per
    second, so each costs more CPU through contention.

### 30.5 Browser QA (production build behind the local TLS proxy, bench database)

All the §29.6 scenarios pass unchanged:

- search, no match, confirmation, name, room;
- date, state and combined filters with sort;
- typed search;
- "Load more" (150 unique rows);
- property switching;
- Global Search reservation results;
- multi-property, restricted and no-permission users.

Totals, rooms and codes render as before. The only console entries are the browser's logs of the
deliberate 403 probes.

## 31. Live updates instead of polling

### 31.1 Audit of polling

Pollers pause while the tab is hidden or unfocused. MEASURED browser volume on the bench database, idle
screens, 5 minutes, before the change: **4 requests a minute on each operational screen, 2 on any other
property page.**

| Screen                                   | Interval | Endpoint(s)                                                                    | Purpose                                   | PG CPU per request (MEASURED) | Stale acceptable?                                           | Push?                                                                                                    |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Header badge (every property page)       | 60 s     | `business-date`                                                                | Business date, audit state, property time | 2.1 ms                        | Minutes: it changes only at the audit and at local midnight | **Yes (converted)**: widest reach; nearly every poll was for nothing                                     |
| Front desk                               | 60 s     | `front-desk/summary`; `arrivals`, `in-house` or `departures` (first page)      | Tab counts, work lists                    | 43 / 46 ms                    | Short: arrivals and check-ins happen at the desk            | **Yes (converted)**: heaviest per user                                                                   |
| Room board (front desk and housekeeping) | 60 s     | `rooms/board`                                                                  | Room statuses                             | 41 ms                         | Short                                                       | **Yes (converted)**                                                                                      |
| Housekeeping                             | 60 s     | `housekeeping/summary`, `housekeeping/tasks` (first page)                      | Counts, task list                         | 4.4 / 4.7 ms                  | Short: task assignment                                      | **Yes (converted)**: same screen as the board                                                            |
| Maintenance                              | 60 s     | `maintenance/summary`, `maintenance` (first page)                              | Counts, requests                          | cheap                         | Minutes                                                     | No (remaining): lower benefit                                                                            |
| Dashboard                                | 120 s    | `dashboard`, front desk, housekeeping and maintenance summaries, arrivals card | Overview                                  | 43 ms (summary)               | Minutes                                                     | No (remaining): already 120 s. It shares the converted queries' cache, so events refresh those parts too |
| Night audit run                          | none     | —                                                                              | —                                         | —                             | —                                                           | —                                                                                                        |
| Connectivity probe                       | 60 s     | `/api/health/live`                                                             | Offline detection                         | no database, no session       | —                                                           | No: costs nothing                                                                                        |
| Offline snapshot                         | 10 min   | front desk lists, board                                                        | Offline copy                              | as above                      | Yes                                                         | No: rare                                                                                                 |

Per user and minute, the converted screens cost ≈ 86–91 ms of PostgreSQL CPU (front desk, board) or
≈ 48 ms (housekeeping), whether or not anything changed.

### 31.2 Approaches compared

- **Short-polling improvements** (conditional requests, versions): every request still authenticates and
  reads. The cost still scales with users × time, not with changes.
- **WebSockets:** bidirectional, which is not needed. It needs a custom server or upgrade handling beside
  Next.js route handlers, and its own authentication.
- **Server-sent events (chosen):**
  - a plain authenticated `GET` through the existing route pipeline (session, property access, rate
    limit);
  - one-way; reconnectable;
  - works with `next start` behind the existing reverse proxies (`no-transform`, `X-Accel-Buffering: no`).
- **Event source across instances:**
  - PostgreSQL `LISTEN/NOTIFY`, fired by row triggers in the writing transaction;
  - not in-memory subscribers, and no broker: nothing measured needs one.
  - The existing integration outbox (`outbox_events`, D35) covers bookings and payments, not room,
    housekeeping or maintenance changes, and nothing dispatches it. The triggers see every writer: API,
    night audit, scripts.

### 31.3 Design

- **Migration `20261215090000_realtime_notifications`:**
  - Triggers on the tables the converted screens read (`reservation_rooms`, `stays`, `reservations`,
    `reservation_notes`, `room_assignments`, `rooms`, `room_service_blocks`, `housekeeping_tasks`,
    `maintenance_requests`, `business_dates`) run `pg_notify('serene_changes', {p, t, x})`: the property,
    the topics and the transaction id.
  - NOTIFY is transactional (a rollback sends nothing) and deduplicated within a transaction. There is
    **no row data** in it.
  - Access triggers (`auth_sessions` revoked, `users` status or password, `user_role_assignments`,
    `role_permissions`, `properties` and `organizations` status) notify `serene_access`.
- **Each instance** holds one LISTEN connection (`lib/realtime/hub.ts`, backoff 1–30 s). While it is down,
  streams get `degraded` and clients poll; when it is back, streams get `live` and clients refetch what may
  have changed.
- **Stream** `GET /api/v1/properties/{id}/events` (`definePropertyRoute`, 30 connects/min per user):
  - Topics are limited to the user's read permissions at that property: `frontdesk:read` → front desk,
    `rooms:read` → board, `housekeeping:read` → housekeeping; the business date needs property access
    only.
  - Events carry topic names and the transaction id only; the client refetches through the normal
    authorized API.
  - Notifications of one burst are merged for 200 ms. There is a heartbeat every 25 s.
  - The stream ends with `reauth` on any access change affecting it, or when the access token expires
    (at most 15 min). The client then reconnects and is authenticated again.
  - `REALTIME_ENABLED=0` answers 204: every screen polls as before.
- **Client** (`PropertyRealtime`, one stream per tab):
  - It is read with `fetch`: a 401 refreshes the session, 403 and 204 stop, errors back off 1–30 s with
    jitter.
  - While live, the converted queries stop polling (a 10-minute safety refetch remains) and events
    invalidate their cache tags:
    - the first change after a quiet period at once;
    - then at most once per topic gap (front desk and board 60 s, housekeeping 15 s, business date at
      once);
    - each after a random 0–5 s spread.
  - Duplicate transaction ids are ignored.
  - Hidden tabs defer refetches and close the stream after 60 s; data possibly stale after a (re)connect
    is refetched once.
  - While not live, screens poll exactly as before.
- **Business date:** while live, it is refetched on audit events and just after the property's local
  midnight. The property time shown advances from the last server value (`usePropertyClock`), not from
  the browser clock.

### 31.4 Request volume (MEASURED)

**Real browser, idle screens, 5 minutes, requests per minute** (the connectivity probe, 1/min, included):

| Screen                                             | Before | After |
| -------------------------------------------------- | ------ | ----- |
| Front desk                                         | 4      | 1     |
| Room board                                         | 4      | 1.2   |
| Housekeeping                                       | 4      | 1     |
| Maintenance (not converted; badge no longer polls) | 4      | 3     |
| Dashboard (not converted)                          | 4      | 3     |
| Any other property page                            | 2      | 1     |

**Front desk staff simulation.** Two `next start` instances; users alternate between them. Changes are
room updates committed at SMR at the given rate (Poisson). Each run lasts 4 min and is measured over its
last ≈ 3 min.

| Users | Changes/min | Before req/min (per user) | After req/min (per user) | Change |
| ----- | ----------- | ------------------------- | ------------------------ | ------ |
| 8     | 0           | 23.7 (2.96)               | 0 (0)                    | −100 % |
| 16    | 0           | 47.3 (2.96)               | 0 (0)                    | −100 % |
| 32    | 0           | 95.4 (2.98)               | 0 (0)                    | −100 % |
| 8     | 1           | 23.7 (2.96)               | 11.0 (1.37)              | −54 %  |
| 16    | 1           | 47.3 (2.96)               | 14.4 (0.90)              | −70 %  |
| 32    | 1           | 95.4 (2.98)               | 65.8 (2.06)              | −31 %  |
| 8     | 4           | 23.7 (2.96)               | 16.4 (2.05)              | −31 %  |
| 16    | 4           | 47.3 (2.96)               | 32.9 (2.06)              | −30 %  |
| 32    | 4           | 95.4 (2.98)               | 65.7 (2.05)              | −31 %  |

- The realized change count varies per run, so the "1 change/min" rows differ.
- The first design refetched each topic at most every 30 s. At 1 change/min it already cost as much as
  polling: 8 users, 21.9 req/min. Hence the 60 s gap for heavy screens: a busy property is capped below
  polling, and a quiet one costs nothing.

### 31.5 Database impact (MEASURED)

- **Connections:**
  - Before: at most 3 active and 6 open.
  - Idle after: 2 open, the two LISTEN sessions.
  - Busy after: at most 2–8 active and up to 15 open.
- **PostgreSQL CPU:** 0–4 % of the machine in every run. At these user counts the difference is below
  what the counters resolve; per request, see §31.1.
- **Rows read per minute:**
  - Idle: 78.8k–298k → ≈ 2.5k (the samplers only).
  - With changes: similar to or above polling, e.g. 32 users: 298k–300k before, 369k–375k after, despite
    31 % fewer requests.
  - Refetches arrive in waves. Measured with 32 screens:
    - within 2 s: 17 % more rows per request pair than one at a time;
    - within 5 s: the same as one at a time (hence the 5 s spread);
    - after more than 30 s idle: the pool had closed its connections (`POOL_IDLE_TIMEOUT_MS` 30 s), and
      each wave opened ≈ 10 new PostgreSQL sessions and read 26 % more rows (catalog warm-up).
  - **PROPOSED:** a longer pool idle timeout (e.g. 120 s) for instances serving live updates, measured
    first.
- **Trigger cost on writes:** 0.06 ms median per single-row write (warm; 8–9 ms once per connection while
  the function compiles); 4.8 ms for 300 rows in one statement; 156 ms of a 3.5 s update of 5,000
  reservation rooms (4 %).

### 31.6 Update latency (MEASURED)

- **Commit → event at the client**, both instances, 8–32 streams:
  - p50 214–217 ms, p95 215–248 ms, p99 216–250 ms, of which 200 ms is the merge window;
  - 0 errors in 9 runs.
- **Instance A → instance B:**
  - API commands (mark room dirty/clean) on A, stream on B: 19 of 19 successful commands delivered; the
    20th was rejected (422) and committed nothing.
  - p50 206 ms, p95 211 ms after the command's response.
- **Browser, command → board data on screen:** 2.2–3.8 s. That is the 0–5 s spread plus the refetch.
  Before it was up to 60 s (≈ 30 s on average).

### 31.7 Failure and reconnect (MEASURED)

- **LISTEN session killed on both instances:**
  - every stream got `degraded` within 30 ms and `live` again after 966–981 ms;
  - the streams stayed open, and the next change arrived in 219 ms.
- **Browser offline 20 s:** no stream attempts while offline; reconnected 8 ms after coming online; each
  stale screen was refetched once.
- **Hidden tab:** the stream closed after 60.0 s, with no refetch while hidden; it reconnected 3 ms after
  the tab was shown, with one refetch per screen.
- **Access change** (role assignment updated): the server ended the stream, and the client reconnected in
  48 ms (200).
- **Sign-out:** one reconnect attempt (401, refresh refused), then none.

### 31.8 Security (integration tests `tests/integration/realtime.test.ts`, unit `tests/unit/realtime.test.ts`)

- The stream requires a session (401) and access to the property: another property of the organization,
  or another organization's, gets 403.
- Topics are limited to the read permissions held at the property.
- A change reaches only its property's streams, never another property or organization. Events contain
  only `t` and `x`.
- A rolled-back transaction sends nothing; one transaction's rows arrive as one event.
- A business date initialization notifies every topic.
- A second hub (a second instance) hears the same change.
- Sign-out, disabling the user, removing their role and deactivating the property each end the stream at
  once. A reconnect is refused (401 or 403), and an unrelated property's stream stays open.

### 31.9 Remaining

- **Maintenance screen** (60 s) and **dashboard** (120 s) still poll. Converting them is the same pattern:
  the `maintenance` topic already fires from `maintenance_requests`.
- **Rows read with changes:** the pool idle timeout (§31.5), and a property-level cache of identical
  refetches (many screens ask the same question after one change): **PROPOSED**, not measured.
- **Deployment:**
  - One LISTEN connection per instance.
  - `REALTIME_DATABASE_URL` must be a session (not transaction-pooled) connection.
  - Proxies must not buffer `text/event-stream`, and idle timeouts must exceed 25 s (the heartbeat).
- **Not claimed:** 100 000 requests per second.

## 32. Connection pooling and PgBouncer readiness

### 32.1 Connection lifecycle (audited)

| Path                                                                    | Connection                                                                                                 | Held for                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| API requests, services, repositories                                    | the Prisma client's `pg.Pool` (one per instance)                                                           | one statement (`pool.query`) or one interactive transaction (`runInTransaction`: `maxWait` 5 s, `timeout` 15 s) |
| Authentication, rate-limit store (`rate_limit_windows`)                 | the same pool                                                                                              | one statement each                                                                                              |
| Live updates (§31)                                                      | one dedicated `pg.Client` per instance (`LISTEN`, `application_name` `serene-management-realtime`)         | the life of the process                                                                                         |
| Night audit, reports                                                    | the same pool; the audit commit raises `statement_timeout` for its own transaction (`set_config(…, true)`) | its transaction                                                                                                 |
| Ops commands (`seed`, `maintenance`, `backup`, `db-check`, `bootstrap`) | their own short-lived clients or pools                                                                     | the command                                                                                                     |

- No session state is used anywhere:
  - no `SET` outside a transaction;
  - no session advisory locks (only `pg_advisory_xact_lock`);
  - no cursors, temporary tables, `PREPARE`, or `LISTEN` outside the hub.
- The Prisma pg adapter sends unnamed prepared statements (no `statementNameGenerator`).
- **Pool defaults before this phase:** `max` 10, idle timeout 30 s (a constant), no minimum, no lifetime,
  acquisition timeout (`connectionTimeoutMillis`) 5 s.
- The benchmark server allows `max_connections` 100 (3 reserved) on 8 cores.

### 32.2 Measured behaviour (MEASURED; one 8-core host shared by PostgreSQL, the instances and k6; default k6 mix, closed model, 30 s runs)

"Pool wait" is the time a request spent waiting for pooled connections. It is new: the Server-Timing
entry `db-acquire` (SERVER_TIMING=1) comes from a wrapper on `pool.connect`, attributed per request with
`AsyncLocalStorage`.

| Instances × users | req/s | p50 / p95 / p99 ms | Pool wait p95 ms | PG CPU    | Active conns avg / max | Open conns |
| ----------------- | ----- | ------------------ | ---------------- | --------- | ---------------------- | ---------- |
| 1 × 8             | 111.4 | 57 / 130 / 482     | 5.5              | 2.2 cores | 3.1 / 7                | 10         |
| 1 × 16            | 135.4 | 102 / 226 / 453    | 112              | 2.0       | 3.6 / 8                | 10         |
| 1 × 32            | 139.0 | 189 / 471 / 588    | 540              | 2.1       | 3.5 / 9                | 10         |
| 2 × 8             | 142.0 | 43 / 95 / 490      | 2.9              | 3.1       | 4.3 / 8                | 20         |
| 2 × 16            | 152.3 | 87 / 201 / 562     | 26               | 4.2       | 4.6 / 9                | 20         |
| 2 × 32            | 146.3 | 176 / 524 / 741    | 370              | 4.1       | 5.1 / 13               | 20         |
| 4 × 8             | 116.5 | 47 / 125 / 538     | 3.4              | 3.7       | 4.2 / 8                | 40         |
| 4 × 16            | 114.4 | 89 / 359 / 1014    | 7.7              | 3.3       | 5.4 / 14               | 40         |
| 4 × 32            | 146.8 | 174 / 503 / 793    | 114              | 4.5       | 6.1 / 13               | 40         |

- **Open connections:** exactly instances × `max` (10/20/40), so total connections are bounded. With live
  updates, one LISTEN connection per instance is added: 4 instances holding 32 streams had 44
  connections.
- **No connection creation under steady load** (0 new sessions per run). No errors or timeouts.
- **No leaks:** after idling past the idle timeout, every run had 0 open application connections and 0
  `idle in transaction`. LISTEN connections stay at 1 per instance.
- **Where the time goes:**
  - At most 17 connections were ever active, 3–6 on average.
  - Pool wait grows with users per instance, while PostgreSQL stays at 2–4.5 of 8 cores. The single-threaded
    instance is the per-instance limit.
  - The host as a whole is the limit: the plateau is ≈ 140–165 req/s, whatever the instance count.
  - More connections do not help: `max` 20 on 4 instances (80 open) gave 156 req/s and a worse p99
    (1167 ms).

### 32.3 Idle churn (the §31.5 finding)

Waves of 32 users (front desk summary + arrivals, spread over 5 s), 52 s apart, on 2 instances. The
figures are averages over 4 waves, each wave after idling.

| Pool setting                         | New PG sessions per wave | Rows per request pair | Request p50 / p95 ms | Pool wait p95 ms |
| ------------------------------------ | ------------------------ | --------------------- | -------------------- | ---------------- |
| idle timeout 30 s (former default)   | 4.5                      | 10,146                | 42 / 150             | 41               |
| **idle timeout 120 s (new default)** | 0.5                      | 9,189                 | 38 / 52              | 0.2              |
| idle timeout 300 s                   | 0                        | 9,031                 | 39 / 67              | 0.3              |
| idle timeout 30 s, `min` 2           | 0.3                      | 9,075                 | 41 / 77              | 0.4              |

- With 30 s, the pool closed its connections between waves, and each wave reopened them. A new backend
  warms its catalog caches: ≈ 10 % more rows read, and 3× the p95.
- 120 s keeps them through the live-update gap (60 s); every pool still drains to zero after 2 minutes
  without traffic.
- Under steady load the two timeouts measured the same. Alternating 1-instance runs, 8/16/32 users,
  30 s → 120 s:
  - throughput 137.8 → 138.5, 142.2 → 137.9, 141.7 → 139.4 req/s;
  - p95 100 → 97, 213 → 222, 469 → 467 ms.

### 32.4 Other settings tested (MEASURED)

| Setting                            | Run    | Result                                                                                                |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `max` 5                            | 1 × 32 | 124 req/s, pool wait p95 784 ms (vs 139, 540): too small for one busy instance                        |
| `max` 5                            | 4 × 32 | 165 req/s, 143 / 548 / 831 ms, 20 open (vs 147 req/s, 174 / 503 / 793, 40 open)                       |
| `max` 5, 32 streams held           | 4 × 32 | 164 req/s, p50 139 ms, **24 connections** (vs 154 req/s, p50 159, 44 with `max` 10)                   |
| `max` 20                           | 4 × 32 | 156 req/s, p99 1167 ms, **80 open** (near `max_connections`), pool wait ≈ 0                           |
| lifetime 20 s (to price recycling) | 2 × 16 | 32 connections replaced in 30 s; 125 req/s (vs 152), rows/request +8 %                                |
| acquisition timeout 1 s            | 1 × 32 | no errors, but only because the longest wait was 0.8 s; `max` 5 reached 1.2 s (p99), which would fail |

**Chosen defaults:**

- **Idle timeout:** 30 s → 120 s (`DATABASE_POOL_IDLE_TIMEOUT_MS`).
- **Unchanged:** `max` 10 (one instance needs it), `min` 0, lifetime 0 (recycling costs; use hours, not
  seconds, when needed), acquisition timeout 5 s.
- The idle timeout, minimum and lifetime are now settings.

### 32.5 PgBouncer

- **Compatibility** (analysed; PgBouncer itself was not installed):
  - **Transaction mode works:**
    - interactive transactions run on one server connection;
    - statements are unnamed prepared statements, so no `max_prepared_statements` is needed;
    - transaction-level settings and advisory locks only;
    - no session state.
  - **Two exceptions:**
    - The session settings are startup `options`, which PgBouncer rejects. With
      `DATABASE_POOLER=pgbouncer-transaction` they are not sent and must be set on the runtime role;
      `ops:db-check` fails when the zone is not UTC or a timeout is off.
    - LISTEN needs a session. `REALTIME_DATABASE_URL` (direct) is **required** in that mode (env
      validation), and the listener always connects directly.
  - Migrations and backups keep direct URLs.
- **Is it required?** Not at the measured scale.
  - PostgreSQL's CPU and the host's CPU, not connections, bound throughput; at most 17 connections were
    active.
  - At `max_connections` 100, 7 instances of `max` 10 fit, keeping 10 for operations (`ops:db-check`
    prints this budget); with `max` 5, 14 fit.
  - PgBouncer becomes justified when:
    - instances × `max` exceeds that budget (autoscaling, many small instances, serverless);
    - connection storms on deploys need absorbing;
    - more instances must share a fixed number of server connections.

### 32.6 Recommended topology (PROPOSED)

- **Up to ≈ 6 instances: no PgBouncer.**
  - Keep the total within `max_connections` − 10: `DATABASE_POOL_MAX` = budget ÷ instances. For
    example, 4 instances × 5: measured equal or better throughput with half the connections.
  - `DATABASE_POOL_IDLE_TIMEOUT_MS` 120000.
- **More instances, or autoscaling:**
  - PgBouncer in transaction mode in front of `DATABASE_URL` (`DATABASE_POOLER=pgbouncer-transaction`),
    `default_pool_size` ≈ 2–4 × PostgreSQL cores.
  - Session settings on the runtime role.
  - `REALTIME_DATABASE_URL` and `MIGRATION_DATABASE_URL` direct: one LISTEN connection per instance
    counts against `max_connections`.
- **Beyond one database server:** read replicas for reports, measured first. Readiness was prepared in phase 7 (§35); it is not enabled.

### 32.7 Remaining

- The per-instance event loop and the database server's CPU: see §20 and §27.
- The LISTEN connections grow with instances, one each. Past ≈ 50 instances a shared notification relay
  (one listener fanning out) would replace them: **PROPOSED**, not needed now.
- **Not claimed:** 100 000 requests per second.

## 33. Background jobs and the worker

### 33.1 Audit of heavy work inside requests (MEASURED; benchmark clone `serene_bench_na1`, SMR/SDX, one `next start` instance, `SERVER_TIMING=1`)

Every endpoint that can run for seconds was listed from the code (night audit, readiness, 23 reports in JSON and CSV, the organization performance export, organization reports) and measured on the widest range each accepts (366 days ending at the business date). Rows read come from `pg_stat_database` deltas (12 s flush wait); memory is the server's working set around the request.

| Operation                                   | Server time (one user)              | Rows read         | Notes                                                                                            |
| ------------------------------------------- | ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `POST night-audits` (SDX, quiet)            | **11,070 ms** (checks 10,376)       | 2.03 M            | working set 200 → 175 MB; first attempt after a restart 32.8 s                                   |
| `POST night-audits` (SMR, 16-user mix)      | **25,683 ms**                       | —                 | the request held a connection and the client for the whole audit                                 |
| Successful audit, 1,000 rooms in house      | ≈ 15.0 s                            | —                 | integration performance test (`night-audit.performance.test.ts`); the commit may run up to 300 s |
| `GET night-audits/readiness`                | 12–23 s warm, > 30 s cold (`57014`) | ≈ 2 GB of buffers | the same checks; `findUnbalancedFolios` is 95 % of it (§33.8)                                    |
| `guest-ledger` CSV                          | 2,790 ms (JSON 2,969)               | 3.12 M            |                                                                                                  |
| `ledger-roll-forward` CSV                   | 546 ms                              | 2.14 M            |                                                                                                  |
| `cancellations` CSV                         | 1,490 ms                            | 1.12 M            |                                                                                                  |
| `arrivals` / `departures` CSV               | 422 after 914 / 802 ms              | 849 k / 850 k     | refused (`REPORT_TOO_LARGE`) only after reading the rows; working set 246 → 284 MB               |
| `revenue-by-code` CSV                       | 365 ms                              | 538 k             |                                                                                                  |
| `housekeeping` CSV                          | 231 ms                              | 22.8 k            | 10,960 rows, 810 KB                                                                              |
| tax, adjustments, package-revenue, payments | 111–268 ms                          | —                 |                                                                                                  |
| every other report                          | < 150 ms                            | —                 | manager-flash JSON 462 ms                                                                        |

Under concurrency (16-user k6 mix, 45 s):

- **Night audit:** the mix was unchanged while an audit ran (89.6 → 91.2 req/s; p50/p95/p99 148/331/633 → 151/338/673 ms). The audit uses one connection at a time. Its cost was the request itself: a 11–33 s request, longer than many proxy timeouts, holding the browser tab, with the commit allowed up to 300 s.
- **Heavy exports:** 4 users exporting the guest ledger back to back made each export take 11.3 s (p50) and cut everyone else's throughput from 100.2 to 63.0 req/s (p95 293 → 563 ms, p99 604 → 881 ms).

**Decision.**

- **Night audit → background job.** It is the only operation whose single execution is longer than a request should be.
- **Reports and exports stay synchronous.** None takes more than 2.8 s alone; the 20,000-row cap bounds them. Their problem is concurrency, not duration, so they get a per-process slot limit (§33.6). They do not get background files: that would add storage, download links and expiry for no measured gain.

### 33.2 Choosing the queue

| Option                                     | Verdict                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The existing outbox (`outbox_events`, D35) | Not a job queue: integration events with no lease, attempts, owner or result, and never dispatched (PENDING rows are kept for a future integration). Mixing the two would change its retention and meaning.                                                                            |
| Redis + BullMQ, RabbitMQ, Kafka            | New infrastructure to deploy, secure, back up and monitor, for a few audits per property per day. The job must commit with the night audit's own data; a broker would need a second, non-transactional write.                                                                          |
| pg-boss, graphile-worker                   | PostgreSQL-backed, but a new dependency with its own schema and migrations outside Prisma. The needed subset is small (`modules/jobs`, `lib/jobs`).                                                                                                                                    |
| **`background_jobs` table (chosen)**       | Same database, same transaction as the command, same backups, no new process type required. `FOR UPDATE SKIP LOCKED` claims, leases with fencing, LISTEN/NOTIFY wake-up (the phase 4 pattern). Measured headroom: ~100–270 jobs/s (§33.5), several orders of magnitude above the need. |

### 33.3 Design (ARCHITECTURE D65; `modules/jobs`, `lib/jobs`, migration `20261220090000_background_jobs`)

- **Enqueue.** `enqueueJob(tx, scope, { kind, payload, dedupeKey, maxAttempts })` runs in the command's transaction: a job exists exactly when its command committed. A partial unique index allows one QUEUED or RUNNING job per `dedupe_key`. The insert trigger `NOTIFY serene_jobs, kind` wakes idle workers.
- **Claim.** `UPDATE … SET status = 'RUNNING', attempts = attempts + 1, locked_by = worker, locked_until = now() + lease FROM (SELECT id … WHERE status = 'QUEUED' AND run_after <= now() ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1)`. Concurrent workers skip each other's rows.
- **Lease and heartbeat.** The worker renews `locked_until` every lease/3 (default lease 60 s), with `SKIP LOCKED`: a row locked by the job's own commit reports "busy", not "lost".
- **Fencing.** Every later write (progress, success, failure) requires `status = 'RUNNING' AND locked_by = me AND attempts = my attempt`. A handler that commits work locks its job row in that transaction (`assertLease`) and marks the job SUCCEEDED there (`completeIn`). A worker whose lease expired and was taken over can therefore change nothing.
- **Failure and retry.** A thrown error retries after 5 s · 2^(n−1), capped at 5 min, with 50–100 % jitter. Lost database connections (`08xxx`, `57P01`–`57P03`, `53300`, Prisma `P1001`/`P1017`/…) count as retryable. `JobFailure` is final. After `max_attempts` the job is FAILED and the handler's `onGiveUp` runs.
- **Crash recovery.** Each worker reclaims expired leases (`FOR UPDATE SKIP LOCKED`) once per poll interval: back to QUEUED with the backoff (`WORKER_LOST`), or FAILED when the attempts are used up.
- **Where it runs.** In every application process (`JOB_WORKER=inline`, started from `instrumentation-node.ts`), or in separate processes (`npm run worker`), or both. SIGTERM stops claiming and waits for running jobs; anything left is reclaimed after its lease.
- **Visibility.** `GET /api/v1/jobs/{id}` returns status, attempts, public progress (a stage name and counts), the result or a safe error to the user who started the job, in their organization, while they can reach its property; everyone else gets 404. Payload, internal error, worker and lease are never returned.
- **Retention.** Finished jobs are pruned after 30 days (`ops:maintenance`, target `backgroundJobs`).

**Night audit as a job.**

- `POST night-audits` keeps Phase A in the request: business date `FOR UPDATE`, Idempotency-Key, the RUNNING run, date IN_AUDIT, audit row. In the same transaction it queues `night_audit.run` (dedupe key per run, 3 attempts) and answers **202** with the run and its job.
- Every refusal is unchanged and immediate: 409 `BUSINESS_DATE_CHANGED`, 409 `NIGHT_AUDIT_RUNNING`, 422 `DATE_AHEAD`, 423 for postings while IN_AUDIT. A replayed Idempotency-Key returns the same run, never a second job.
- The worker runs Phases B and C (`executeNightAudit`).
  - It re-reads the starter's access (`resolveJobActor`): a user disabled or stripped of `nightaudit:run` meanwhile gets a FAILED run (`PERMISSION_REVOKED`), with nothing posted.
  - A run that is no longer RUNNING is left alone (idempotent re-delivery).
  - Lock order is business date → run → job in the commit, the failure record and recovery alike.
  - A lost connection retries the job (the commit rolled back as a whole); any other error fails the run exactly as before.
- **Two workers can never run the same audit.** Claims are exclusive. After a lease expiry, a late worker's commit fails its `assertLease`; it also needs the business date lock and a RUNNING run, as before.
- **Recover.**
  - Refused while a worker holds a live lease (409 `NIGHT_AUDIT_IN_PROGRESS`).
  - A run whose job has not started can be cancelled at once (`CANCELLED`, job CANCELLED).
  - A stale run without a live worker is recovered as before (`RECOVERED`); its job is cancelled so it can never run.
- **UI.** The start dialog navigates to the run page. The page polls every 2 s while RUNNING (paused in background tabs) and shows "Queued", "Running the checks", "Posting and closing the day", or the retry and its time. When the run ends it refreshes the business date and every operational list.

### 33.4 Night audit before / after (MEASURED; same clone, same audits)

The benchmark audits fail at the departure check (38 due-outs with balances), a repeatable 10–25 s of checks used as the identical workload before and after. "Completed" is the run's end as the client saw it by polling every 500 ms.

| Run                                                            | Start request                                        | Completed | Queue wait | Job execution                           |
| -------------------------------------------------------------- | ---------------------------------------------------- | --------- | ---------- | --------------------------------------- |
| Before: SDX quiet                                              | 11,070 ms (201, finished)                            | 11,070 ms | —          | —                                       |
| Before: SMR under the 16-user mix                              | 25,683 ms                                            | 25,683 ms | —          | —                                       |
| After, inline worker: SDX quiet                                | 472 ms (202; first request after start)              | 11,454 ms | 40 ms      | 10,963 ms                               |
| After, inline worker: SMR under the mix                        | 640 ms                                               | 19,760 ms | 76 ms      | 19,135 ms                               |
| After, separate worker: SDX quiet                              | 431 ms (first request)                               | 9,706 ms  | 21 ms      | 9,168 ms                                |
| After, separate worker: SMR under the mix                      | 523 ms                                               | 22,714 ms | 47 ms      | 22,166 ms                               |
| After, warm start requests (Server-Timing total)               | quiet 28–48 ms; under the mix 478–585 ms (3 samples) | —         | —          | —                                       |
| After: full successful audits through the UI (SDX, bench data) | —                                                    | —         | 65 ms      | ≈ 15.5 s (143 rooms, 261 nights posted) |

16-user mix (45 s) without and with an audit running:

| Mode            | Baseline req/s, p50/p95/p99 ms | With audit req/s, p50/p95/p99 ms | PG CPU      | Active conns max / avg | Open conns |
| --------------- | ------------------------------ | -------------------------------- | ----------- | ---------------------- | ---------- |
| Before          | 89.6, 148/331/633              | 91.2, 151/338/673                | —           | —                      | —          |
| Inline worker   | 95.8, 129/354/655              | 111.5, 123/280/528               | 190 → 248 % | 8/3.3 → 10/3.7         | 13 → 15    |
| Separate worker | 97.6, 136/326/596              | 109.6, 124/288/577               | 227 → 282 % | 7/3.1 → 11/4.1         | 13 → 15    |

- The start request no longer carries the audit: 11–26 s → under 0.7 s, about 30–50 ms warm on a quiet server.
- The audit itself takes as long as before (same queries). The mix is within run-to-run noise in every mode, as it was before: the audit was never the mix's bottleneck. The first k6 run after a restart is the slower one, so "with audit" reads higher.
- PostgreSQL CPU and connections while an audit runs: +55–60 percentage points and +1 active connection. They were not sampled before; the work is the same queries (**ESTIMATED** unchanged).
- Open connections include each instance's LISTEN sessions (live updates + jobs).

### 33.5 Worker throughput and exclusivity (MEASURED)

1,000 short jobs queued at once. Each is a night-audit job whose run does not exist: it resolves the starter's access, finds no run, fails finally and runs the give-up path, about 7 statements. Separate worker processes on the same host as PostgreSQL.

| Processes × concurrency | Jobs/s | Queue wait p50 / p95 | Execution p50 / p95 | Ran twice | Open conns |
| ----------------------- | ------ | -------------------- | ------------------- | --------- | ---------- |
| 1 × 1                   | 97.5   | 5.3 / 9.8 s          | 5 / 7 ms            | 0         | 2          |
| 1 × 4                   | 204.9  | 2.2 / 4.6 s          | 8 / 14 ms           | 0         | 6          |
| 2 × 4                   | 209.8  | 2.8 / 4.6 s          | 15 / 27 ms          | 0         | 11         |
| 4 × 4                   | 271.5  | 2.0 / 3.5 s          | 19 / 35 ms          | 0         | 22         |

- **No job ran twice** in 4,000 jobs claimed by up to 16 concurrent claimers (`attempts` = 1 for all; every outcome as expected).
- Queue wait here is backlog: 1,000 jobs arrive at once. A single job waited 21–76 ms (§33.4).
- One process at concurrency 1 already handles ≈ 100 short jobs/s, against a need of a few audits per property per day.

### 33.6 Heavy reports: per-process slot (MEASURED)

`HEAVY_REPORT_KEYS` covers the six reports that read 0.5–3.1 M rows over their widest range: guest-ledger, ledger-roll-forward, cancellations, arrivals, departures and revenue-by-code. They run at most `REPORT_HEAVY_CONCURRENCY` at a time per process. Others wait up to `REPORT_HEAVY_WAIT_MS` (30 s), then get 429 `REPORTS_BUSY` with `Retry-After: 5`.

The test: 4 users exporting the 366-day guest ledger back to back, during the 16-user mix (45 s). Runs were alternated, because the host's baseline varied between 84 and 138 req/s from run to run.

| Limit           | Runs | Mix throughput vs its own baseline | Mix p95 vs baseline | PG CPU with exports | Active conns avg | Exports in 45 s (p50 each) |
| --------------- | ---- | ---------------------------------- | ------------------- | ------------------- | ---------------- | -------------------------- |
| none (16)       | 5    | −41 % (0.44–0.79)                  | × 2.0               | ≈ 460 %             | 13.0             | 18 (8.8–18.0 s)            |
| 2               | 2    | −35 % (0.62–0.67)                  | × 1.6               | ≈ 430 %             | 8.3              | 15 (13.1–15.7 s)           |
| **1 (default)** | 3    | **−21 %** (0.67–0.94)              | **× 1.3**           | **≈ 370 %**         | **5.8**          | 11 (16.3–18.3 s)           |

- One slot halves what four heavy exporters take from everyone else.
- The price: the exporters themselves wait their turn (p50 per export ≈ 11.8 → 17.6 s, +50 %), and one that waits longer than 30 s gets 429 (1 of 35 requests in these runs).
- Two slots were no better than no limit within the noise.
- The limit is per process: N instances allow N at once.

### 33.7 Safety (integration tests `tests/integration/background-jobs.test.ts`, 15 tests; `night-audit.test.ts` updated; unit `jobs.policy.test.ts`, `semaphore.test.ts`)

| Requirement                       | Covered by                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Concurrent workers, no duplicates | 3 workers drain one audit: exactly 1 attempt, 1 statistics row; throughput runs: 0 of 4,000 re-executed                                                                                                                                                                                                                  |
| Worker / instance crash           | A claimed job whose lease expires is reclaimed (`WORKER_LOST`, retry due in 2.5–5 s) and completed by the next worker (attempt 2). Browser QA: a worker process killed mid-audit (§33.9)                                                                                                                                 |
| Late worker after a takeover      | Its commit, `finishJob` and failure record are all refused (`LeaseLostError`, 0 rows); the run stays untouched                                                                                                                                                                                                           |
| Database disconnect               | A commit that loses its connection (`57P01`) leaves nothing (no statistics, date still IN_AUDIT, run RUNNING); the job retries and completes. Classifier tested separately                                                                                                                                               |
| Attempts used up                  | After 3 lost leases the job is FAILED, the run FAILED (`JOB_FAILED`) and the date OPEN, with nothing posted                                                                                                                                                                                                              |
| Duplicate delivery                | A finished job delivered again runs once more, finds the run COMPLETED and changes nothing (same date, ledger and statistics)                                                                                                                                                                                            |
| Idempotent start                  | The same Idempotency-Key twice: one run, one job                                                                                                                                                                                                                                                                         |
| Retry / backoff / final failure   | A failing handler is retried after 2.5–5 s and succeeds on attempt 2; one that keeps failing ends FAILED with its compensation called once; `JobFailure` is not retried; unknown kinds are not claimed                                                                                                                   |
| 409 / 422 preserved               | Two simultaneous starts: one 202, one 409; a start during a commit gets 409 `BUSINESS_DATE_CHANGED`; the next date gets 422 `DATE_AHEAD`; postings during the roll get 423                                                                                                                                               |
| Cancellation                      | A queued audit is cancelled at once (`CANCELLED`) and never runs; a held one is refused (409 `NIGHT_AUDIT_IN_PROGRESS`) until its lease expires                                                                                                                                                                          |
| Authorization and isolation       | The job resource answers only its starter (another user at the same property, another organization, an unknown id: 404); no payload, reason, user agent, worker or lease in the body. The starter's permission is re-checked at execution (`PERMISSION_REVOKED`). A starter who lost the property no longer sees the job |
| Repeated polling                  | 20 concurrent polls: all 200, unchanged state                                                                                                                                                                                                                                                                            |

### 33.8 Readiness and the folio balance check (MEASURED; fixed in phase 6B, §34)

The readiness view and Phase B both run the night-audit checks. On the benchmark data, `findUnbalancedFolios` takes 12.0–22.7 s warm and over 30 s cold. That cold case is the statement timeout `57014`: readiness answers 500, and an audit started then fails at its checks. The rule re-sums the ledger of every folio that is not CLOSED, and 200,000 SETTLED folios qualify (one index probe each, ≈ 240 k buffer reads).

- **Done in phase 6B (§34):** the ledger sums are one aggregate pass, proven equivalent.
- Alternatively, restrict the candidates to folios changed since the last closed date. This changes the rule (B4), so it needs a decision.
- Browser QA ran with the statement timeout raised to 120 s for this reason.

### 33.9 Browser QA (production build, local TLS proxy, headless Chrome over CDP, benchmark clone; separate worker processes with a 15 s lease)

Setup: the clone's SDX departures were settled and checked out through the API so its audit can complete; SMR still fails its departure check. Bench user 205 is General Manager at SDX and SMR; 206 is Front Desk Agent at SMR only; 207 is Housekeeper at SDX. The statement timeout was raised to 120 s for this server because of §33.8.

| Scenario                           | Result                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start (SDX, from the dialog)       | The run page opened 0.6 s after submitting: "In progress…", then "Running the checks…" (job RUNNING, stage CHECKS).                                                                                                                                                             |
| Refresh while running              | After a reload the page showed the same live state and kept polling (2 polls in 4 s).                                                                                                                                                                                           |
| Completion                         | COMPLETED with the summary (70 rooms, 70 nights, 60 no-shows, 256 tasks) and every step. The header's business date moved to the next date without a reload. Polling stopped (0 requests in 6 s). The job resource showed SUCCEEDED with `result.runId`.                        |
| Blocking checks                    | On SMR the dialog's Run button stays disabled; the start was then sent as another session would (API from the page).                                                                                                                                                            |
| 409 / 422                          | A second start while SMR ran: 409 `NIGHT_AUDIT_RUNNING`. A start on SDX after it closed today's date: 422 `DATE_AHEAD`.                                                                                                                                                         |
| Sign out and back in while running | Signing out ended the session (the run API answered 401). After signing in again, the run's URL showed the run still RUNNING, then FAILED.                                                                                                                                      |
| Failure                            | FAILED, `PRE_CHECK_FAILED`: "Blocking checks: Departures … Nothing was posted and the business date is still open", with the failed step listing the due-outs.                                                                                                                  |
| Worker crash and retry             | The worker process running the checks was killed. 12 s later (15 s lease) the next worker had reclaimed the job. The page read "The job stopped responding; it will be retried automatically. Next attempt at 16:47 (1 of 3 used)", with Cancel audit available. Attempt 2 ran. |
| Retry outcome                      | Attempt 2 ended FAILED `57014` after 124 s: the §33.8 balance check timed out. Likely it was slowed by the killed worker's query, which PostgreSQL keeps running until it finishes or times out (not verified). The run reopened the date, with nothing posted.                 |
| Unauthorized                       | The agent (no `nightaudit:read`) saw "Access denied" on the run page; the run API answered 403; the job resource answered 404.                                                                                                                                                  |
| Multi-property isolation           | The agent opened an SDX run: "You do not have access to this property"; the API answered 403 and the SDX job 404. The SDX housekeeper also got 404 for the SDX job (not its starter).                                                                                           |
| Console                            | Network errors only from the deliberate 401/403/404/409/422 calls. One React hydration error (#418) on the first page load after login. It was not reproduced on a re-run of login and both night-audit pages, and is not in a component changed here.                          |

### 33.10 Remaining

- **The night-audit checks** (§33.8) were the longest part of an audit and made readiness a slow synchronous GET; see §34 for the fix and what remains.
- **Night-audit Phase C** runs as one transaction of up to 300 s (≈ 15 s for 1,000 rooms). It still blocks postings at its property while it runs, by design.
- **Heavy reports** remain synchronous and per-process limited. With many instances, or exports beyond 20,000 rows, move them to jobs with stored files. **PROPOSED**; not needed at the measured sizes.
- **Arrivals and departures** read ≈ 850 k rows before refusing an over-limit range: a count-first guard would refuse in milliseconds. **PROPOSED.**
- **The queue** polls each worker every 5 s when idle (one indexed query). With hundreds of worker processes, raise `JOB_POLL_INTERVAL_MS`: LISTEN wakes them anyway.
- **A killed worker's query** keeps running on the database until it ends or times out. `client_connection_check_interval` (PostgreSQL 14+) on the runtime role would cancel it soon after the client is gone. **PROPOSED**, not measured.
- **Not claimed:** 100,000 requests per second.

## 34. Night-audit balance check

### 34.1 Root cause (MEASURED; clone `serene_bench_na2` of the benchmark database, PostgreSQL 18, `shared_buffers` 128 MB)

`findUnbalancedFolios` (the `VALIDATE_BALANCES` check of readiness and of the audit's Phase B) re-sums the ledger of every candidate folio. A folio is a candidate when it is not CLOSED, or when it has a line dated D (rule B4).

- The rule is not the problem. Each benchmark property has 200,181 candidates (181 OPEN, 200,000 SETTLED, none CLOSED) and 800,165 ledger lines.
- The statement shape is. The candidates CTE was inlined and the ledger was a correlated `(SELECT sum(amount) … WHERE folio_id = c.id)`, executed **once per folio**: 200,181 index scans on `folio_items(folio_id, posted_at)` and their heap pages, at random.
- `EXPLAIN (ANALYZE, BUFFERS)`: **5.2–7.4 s** (6 runs, warm), 1.31 M buffers per run (1.06 M hit, 245 k read: ≈ 10 GB of page accesses), 0 rows.
- The run takes all of `shared_buffers` and more, so it is never fully cached. Together with the other checks, readiness took 7.4 s for one user. In phase 6 it took 12–23 s and passed 30 s cold (§33.8).

### 34.2 Change

The same candidates (CTE `MATERIALIZED`); then **one aggregate** of their ledger lines (`sum(amount) GROUP BY folio_id` over `folio_items` of the property whose `folio_id` is a candidate), `LEFT JOIN`ed to the candidates. A folio with no lines gets `COALESCE(…, 0)`, exactly as the scalar subquery did. The selected columns, the two mismatch predicates and `ORDER BY id` are unchanged.

`i.property_id = $property` is added to the aggregate. It cannot change the result: a line references its folio through the composite key `(property_id, folio_id) → folios(property_id, id)`, so every line of a candidate folio has the candidate's property (proven by a test that the database refuses the opposite: `23503`). It lets the scan read only the property's lines.

No rule, schema, index, migration, error or API changed.

### 34.3 Candidates compared (MEASURED; SMR, warm, 2–3 runs each)

| Statement                                                   | All 200 k folios candidates | Buffers  | Temp written | 199 k of them CLOSED (≈ 1,200 candidates, rolled back) | Buffers |
| ----------------------------------------------------------- | --------------------------- | -------- | ------------ | ------------------------------------------------------ | ------- |
| current (correlated sum)                                    | 5.2–8.6 s                   | 1.31 M   | 0            | 0.39–0.82 s                                            | 0.43 M  |
| **B: aggregate of the candidates' lines + property filter** | **2.1–3.0 s**               | **26 k** | 106 MB       | 0.75–0.98 s                                            | 31 k    |
| C: B without the property filter                            | 2.2–3.5 s                   | 46 k     | 122 MB       | 1.05–1.15 s                                            | 51 k    |
| B with `work_mem` 32 MB                                     | 2.0–2.2 s                   | 26 k     | 11 MB        | —                                                      | —       |
| B without `MATERIALIZED`                                    | same plan as B              |          |              | same as B                                              |         |

- **B was chosen.** It is 2.5–3× faster when every folio is a candidate (the benchmark shape). That is the shape of any hotel that does not invoice every stay: SETTLED folios are never CLOSED, so the candidates grow with history.
- With few candidates it is at parity (0.75–0.98 s against 0.39–0.82 s): both statements then spend their time elsewhere (the date test on 199,000 CLOSED folios). Neither shape is slow there.
- **`work_mem` stays at the default.** 32 MB removes the hash-aggregate spill (106 → 11 MB of temp writes, ≈ 25 % faster). But it applies per hash node and per concurrent check, and 32 checks at once could take gigabytes. **PROPOSED** only, behind a measured need.

### 34.4 Equivalence (MEASURED)

| Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `tests/db/night-audit-balances.test.ts` (PGlite, all migrations): the production statement, captured from the repository function, against the previous statement verbatim.                                                                                                                                                                                                                                                                                                         | identical                                        |
| — 16 named folios: OPEN / SETTLED / CLOSED drift; CLOSED with a line on D, before D, or with no lines; no lines with a non-zero balance (ledger `0`); all zero; partially paid with and without a 0.0001 drift; a balanced SETTLED folio; a USD folio at a PKR property; 99,999,999.9999 amounts; negative balances; totals that disagree with the balance; an account folio (`reservation_room_id` NULL, window 2); drifted folios at another property and in another organization | exactly the 9 expected folios, same decimal text |
| — 1,200 seeded random folios (3 properties, 2 organizations, 3 statuses, 3 currencies, 0–6 lines over 4 dates, 25 % drifted) × 3 properties × 5 dates                                                                                                                                                                                                                                                                                                                               | identical (> 500 rows reported)                  |
| — every reported folio belongs to the queried property; a line of one property on another property's folio is refused (`23503`)                                                                                                                                                                                                                                                                                                                                                     | yes                                              |
| — mutation check: the same test fails when the join is made inner or the ledger is rounded                                                                                                                                                                                                                                                                                                                                                                                          | fails as it should                               |
| Clone, real data: both properties × the current date, earlier dates and a date without lines                                                                                                                                                                                                                                                                                                                                                                                        | identical (0 rows: the real ledger is balanced)  |
| Clone, adversarial, in a rolled-back transaction: 300 folios off by 0.0001, 500 closed (half drifted), 300 with an extra line on D, 100 switched to USD and drifted, per property                                                                                                                                                                                                                                                                                                   | identical, 6,968 rows reported, none foreign     |

### 34.5 Load: `GET night-audits/readiness` (MEASURED; one `next start`, pool max 10, default 30 s statement timeout, 60 s per level, users alternate SMR/SDX)

| Users | Before: ok/min, p50 / p95 ms, errors  | After: ok/min, p50 / p95 ms, errors   | Buffers per readiness | PG CPU before → after |
| ----- | ------------------------------------- | ------------------------------------- | --------------------- | --------------------- |
| 1     | 8.2, 7,357 / 7,641, 0                 | 22.5, 2,695 / 2,801, 0                | 1.32 M → 33 k         | 67 % → 60 %           |
| 8     | 18.8, 22,865 / 29,115, 0              | 104.2, 4,729 / 5,024, 0               | 1.32 M → 33 k         | 74 % → 554 %          |
| 16    | 24.2, 23,901 / 30,462, **54 of 83**   | 102.7, 9,054 / 11,711, **0**          | 1.36 M → 33 k         | 106 % → 542 %         |
| 32    | 13.7, 24,350 / 25,847, **242 of 258** | 100.0, 17,578 / 24,541, **11 of 137** | 2.48 M → 33 k         | 102 % → 557 %         |

- **Before, the errors were not query timeouts but the pool.** Ten slow checks held all ten connections, and every other request waited past the 5 s acquisition timeout ("timeout exceeded when trying to connect"), including authentication. Readiness from a few users made the whole instance fail.
- **After:**
  - 5–7× the throughput, with no errors up to 16 users.
  - At 32 users, 11 requests still waited past 5 s for a connection: 32 concurrent checks on a pool of 10.
  - PostgreSQL now works at ≈ 5.5 cores instead of waiting on reads: about 1.6 core-seconds per readiness at 1 user, ≈ 3.2 under load, against 2.4–4.9 before.
  - Each readiness writes ≈ 78 MB of temporary files (the hash-aggregate spill).

### 34.6 Browser QA (production build, local TLS proxy, headless Chrome, clone; default 30 s statement timeout; separate worker with a 15 s lease)

| Scenario               | Result                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness              | SDX and SMR rendered every check, "Folio balances: Every folio balance equals its ledger" (PASSED). The readiness API took 2.6 s and 1.8 s; the pages were complete in 6.2 s and 4.3 s from navigation. Phase 6 QA needed the statement timeout raised to 120 s; this ran at the default 30 s.     |
| Successful audit       | SDX, started from the dialog: COMPLETED 7.2 s after the start (the job ran 2.6 s of checks plus the commit). The phase 6 QA audit of the same property took ≈ 15.5 s.                                                                                                                              |
| Failed audit           | SMR (guests due out still in house): FAILED `PRE_CHECK_FAILED` 1.1 s after the start, with the failing step and its guests; date OPEN.                                                                                                                                                             |
| Concurrent start       | Two starts at once from the page: one 202, one 409 `NIGHT_AUDIT_RUNNING`; the winner then failed its checks as expected.                                                                                                                                                                           |
| Recovery: queued audit | With no worker running, the run page showed "Queued: waiting for a worker…" and Cancel audit. Cancelling with a reason gave FAILED `CANCELLED` ("Cancelled while waiting for a worker; nothing was posted"), the job CANCELLED, the date OPEN.                                                     |
| Recovery: stale run    | A worker's claim with an expired lease and no worker alive (written into the job row: the state a crashed worker leaves). "Recover stale run" appeared once the run was 2 minutes old (118 s after it opened). Recovering with a reason gave FAILED `RECOVERED`, the job CANCELLED, the date OPEN. |
| Console                | No page exceptions in either run.                                                                                                                                                                                                                                                                  |

### 34.7 Remaining

- **Readiness still costs ≈ 2–3 s and ≈ 78 MB of temp IO per view**, and grows with the property's ledger. More speed needs one of two things:
  - `work_mem` for this statement (§34.3, PROPOSED);
  - a narrower rule: candidates changed since the last closed date, or SETTLED folios closed after a retention period. That is a business decision (B4), not made here.
- **32 concurrent readiness views** still exceed a 10-connection pool. Readiness is opened by a few night auditors, not by every user, but heavy GETs share one pool with everything else.
- **The other checks** (unposted nights, due arrivals) are 0.1–0.3 s each and were not changed.

## 35. Read scaling and read-replica readiness

**Decision: B. Replica readiness is prepared, not enabled.** Replicas are not justified by the measured workload. The primary runs at about a quarter of its CPU, and almost every read must see the latest write. The only workload that tolerates staleness and costs real database time is analytical reports over closed dates. Phase 6 measured those slowing everyone else down (§33.6). For them, an optional replica route now exists, off unless `READ_DATABASE_URL` is set. **No physical replica was measured:** the environment has one native PostgreSQL, and the runtime role has no `REPLICATION` privilege. Every replica performance number below is **NOT MEASURED** or **ESTIMATED**.

### 35.1 Workload (MEASURED; clone `serene_bench_na3`, one `next start`, pool max 10, default k6 mix, 45 s per level)

| Users | req/s | p50 / p95 / p99 ms | Pool wait p95 / avg ms | PG CPU (8 cores) | Active conns avg / max | Rows read/s | Rows written/s | Transactions/s |
| ----- | ----- | ------------------ | ---------------------- | ---------------- | ---------------------- | ----------- | -------------- | -------------- |
| 1     | 50.2  | 14 / 36 / 215      | 1 / 0.2                | 38 %             | 0.75 / 3               | 0.91 M      | 2.3            | 279            |
| 8     | 133.9 | 49 / 105 / 422     | 6 / 1.4                | 196 %            | 3.24 / 8               | 2.41 M      | 6.0            | 708            |
| 16    | 132.7 | 103 / 238 / 461    | 121 / 34.7             | 209 %            | 3.48 / 9               | 2.35 M      | 5.7            | 685            |
| 32    | 136.5 | 191 / 491 / 613    | 547 / 178.9            | 206 %            | 3.51 / 9               | 2.39 M      | 5.9            | 705            |

- **What the database does.** Active-session sampling (application backends, every 50 ms) found 98–99 % of busy time in reads: 70–79 % autocommit reads, 20–28 % reads inside transactions. Write statements took ≤ 0.2 %; idle-in-transaction waits took 1–2 %. About 2.4 M rows are read per second, against 6 written.
- **Where the limit is.** Throughput stops at ≈ 135 req/s from 8 users on. Pool wait grows (p95 547 ms at 32 users), while PostgreSQL stays at ≈ 2 of 8 cores, with 3.5 of 10 connections active on average. The single-threaded application instance is the bottleneck, as in §32. A replica takes load off the primary's CPU, which is not the constraint here.
- **Request mix.** The default k6 mix is 99 % GET by count. GET does not mean read-only: six rate-limited GET routes write `rate_limit_windows`, and every authenticated request reads the session, which must reflect revocation at once.

### 35.2 Where the database time goes (MEASURED per class, 8 users × 20 s each, weighted by the mix)

| Class              | PG CPU ms / req | Rows read / req | Share of PG CPU | Share of rows | Replica?                                      |
| ------------------ | --------------- | --------------- | --------------- | ------------- | --------------------------------------------- |
| guestSearch        | 235.9           | 284,400         | **40.9 %**      | **73.1 %**    | primary: a profile just created must be found |
| roomBoard          | 39.9            | 6,565           | 12.1 %          | 3.0 %         | primary: room state                           |
| arrivals           | 27.1            | 1,860           | 9.4 %           | 1.0 %         | primary: front desk                           |
| reservationSearch  | 40.7            | 41,221          | 8.8 %           | 13.2 %        | primary: a booking just made must be found    |
| frontDeskSummary   | 28.4            | 6,884           | 7.4 %           | 2.7 %         | primary                                       |
| inHouse            | 15.2            | 3,236           | 3.9 %           | 1.2 %         | primary                                       |
| dashboard          | 19.8            | 4,761           | 3.4 %           | 1.2 %         | primary (today)                               |
| departures         | 17.7            | 2,124           | 3.1 %           | 0.5 %         | primary                                       |
| reservationList    | 7.4             | 3,839           | 2.2 %           | 1.7 %         | primary                                       |
| folioList          | 16.0            | 1,814           | 2.1 %           | 0.3 %         | primary: folio/payment state                  |
| housekeepingTasks  | 6.7             | 531             | 1.7 %           | 0.2 %         | primary                                       |
| availability       | 7.1             | 3,072           | 1.2 %           | 0.8 %         | primary: inventory                            |
| businessDate       | 1.0             | 316             | 0.9 %           | 0.4 %         | primary: business date                        |
| others (8 classes) | 0.8–11.8        | 297–3,170       | 3.4 % together  | 0.9 %         | primary (report = manager flash for today)    |

- **Replica-eligible share of the default mix:** 0 %. Its only report covers the open business date.
- **Upper bound:** even if every report and dashboard view tolerated staleness, about 4 % of the database's CPU could move (**ESTIMATED** from the table).
- **The real cost is guest search:** 41 % of PostgreSQL CPU and 73 % of the rows read, which is a query to fix, not to replicate (§35.9).

### 35.3 Consistency classification (from the audit of all 158 route files)

| Path                                                                                                                      | Class                          | Where                    | Why                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication (`resolveSession` on every request), login, refresh, sessions, users and roles                             | read / transactional           | **primary**              | logout, disabling and role changes apply on the next request                                                                               |
| Rate limits (`rate_limit_windows`, UNLOGGED)                                                                              | write on the hot path          | **primary**              | written on every mutating and rate-limited request; not replicated                                                                         |
| Every command (reservations, check-in/out, folios, payments, housekeeping, maintenance, groups, loyalty, rates, profiles) | read-then-write, transactional | **primary**              | interactive transactions, `FOR UPDATE`/`FOR SHARE`, one advisory lock (restrictions), idempotency keys                                     |
| Read-back after a command (`getReservation`, `getStay`, `getFolioAccount`, `getRoom`, `getRun`, …)                        | read-your-writes               | **primary**              | the response must show what was just committed                                                                                             |
| Front desk, room board, housekeeping, maintenance, availability, folios, billing, business date                           | operational reads              | **primary**              | room, inventory, folio and date state must be current; these are also 85 % of database time (§35.2)                                        |
| Global search, reservation and guest search, companies, groups, loyalty lists                                             | read-heavy                     | **primary**              | a record just created must be findable; the cost is a query problem (§35.9)                                                                |
| Night audit (readiness, commit, worker), background jobs                                                                  | transactional / background job | **primary**              | business-date and ledger checks must be exact; the queue needs `SKIP LOCKED` and leases                                                    |
| Realtime (LISTEN), job wake-up (LISTEN)                                                                                   | realtime                       | **primary (direct)**     | notifications come from the primary's commits                                                                                              |
| Dashboard, manager flash and any report whose range includes the open business date; in-house and room-status reports     | report reading live data       | **primary**              | a posting must appear in the next report                                                                                                   |
| **Reports and CSV exports whose whole range is before the business date; organization performance of closed dates**       | **report / analytical read**   | **replica when enabled** | closed dates are finalized by night audit (postings into them are refused), so seconds of lag cannot hide a business change; heavy (§33.6) |

A query that only selects is not therefore replica-safe. Many repository functions (rates, properties, billing headers, night-audit configuration) are shared between plain reads and write transactions. That is why routing is explicit per call site, and never global.

### 35.4 Design (`lib/db/read-replica.ts`, ARCHITECTURE D67)

- **Settings.** `READ_DATABASE_URL` (optional), `READ_DATABASE_POOL_MAX` (default 3), `READ_REPLICA_MAX_LAG_MS` (default 30 000).
- **Unset (the default).** Nothing changes: one Prisma client, one pool, every query on the primary.
- **`readFromReplica(eligible, work)`.** This is the only way to the replica: the caller states eligibility and passes a read-only function. It runs on the replica only when all of these hold:
  - a replica is configured;
  - the call is eligible;
  - the replica answered its health probe within 2 s;
  - its lag is within the limit.
    Otherwise the read runs on the primary.
- **Health probe** (at most every 10 s). `pg_is_in_recovery()`; lag 0 when the WAL receive and replay positions are equal, else `now() − pg_last_xact_replay_timestamp()`.
- **Failure.** A connection error, a recovery conflict (`40001`) or `53300` during the read marks the replica unhealthy and re-runs the same read on the primary. A dead replica costs one failed attempt per 10 s, not one per request. Other errors propagate unchanged.
- **Wired today:** `computeReport` (JSON and CSV) and `propertyPerformance` (organization performance). Eligible when `to < business date` and the report is not live (`LIVE_REPORT_KEYS`: in-house, room-status).
- **Authorization** happens before routing, on the primary: session, property access, report permission, `reports:financial`. The replica runs the same property-scoped statements.
- **Observability.** With `SERVER_TIMING=1`: `db-read;desc="replica=1"`, `"primary=1"` or `"fallback=1"`. No host, user or database name. `npm run ops:db-check` reports "not configured", "standby, lag N ms", "unreachable" or "not a standby".

### 35.5 Tests (MEASURED; `tests/integration/read-replica.test.ts` 13 tests, `tests/unit/env.test.ts`)

The "replica" in tests is a second pool to the same test database, with a stubbed health probe. This validates routing, fallback and isolation code paths. It is **not** a measurement of replication.

| Requirement                            | Result                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No replica configured                  | primary                                                                                                                                                                                                                                       |
| Safe read → replica                    | runs on the replica pool (`application_name = serene-management-read`); a non-eligible read stays on the primary                                                                                                                              |
| Writes, transactions, read-your-writes | Create a reservation then read it, check in, post a charge, then read the folio, room board, business date, availability, arrivals, dashboard, an open-date report, in-house and room-status: **0 replica checkouts**, all showing the writes |
| Closed-date reports                    | five reports, the CSV export and organization performance used the replica, and their results equal the primary's (JSON deep-equal, CSV byte-equal)                                                                                           |
| Replica lag                            | lag 120 s > 30 s limit → primary (`fallback`)                                                                                                                                                                                                 |
| Replica unavailable / timeout          | unreachable host → fallback; the second read does not wait again (< 500 ms); a probe that never answers → fallback in < 3.5 s; a database that does not exist → fallback                                                                      |
| Replica error during the read          | a lost connection mid-read → the same read on the primary; any other error propagates                                                                                                                                                         |
| Replica down for a report              | same report as the primary's, 200                                                                                                                                                                                                             |
| Permissions and isolation              | a front desk agent (no access to the financial report), another property's manager, another organization's user: 403 with **0 replica checkouts**; property B's report never contains A's data                                                |
| Primary unavailable                    | **NOT TESTED**: nothing works without the primary, by design (sessions, rate limits). The replica is never used for failover                                                                                                                  |

### 35.6 Load after the change (MEASURED; same harness, `READ_DATABASE_URL` unset)

| Users | req/s (before → after) | p50 / p95 / p99 ms after | PG CPU after |
| ----- | ---------------------- | ------------------------ | ------------ |
| 1     | 50.2 → 50.8            | 13 / 35 / 235            | 34 %         |
| 8     | 133.9 → 143.2          | 46 / 96 / 401            | 194 %        |
| 16    | 132.7 → 147.5          | 94 / 206 / 426           | 192 %        |
| 32    | 136.5 → 147.4          | 178 / 449 / 574          | 189 %        |

- **No regression.** The differences are within this host's run-to-run noise (§33.6); the routing call costs nothing measurable when no replica is set.
- **Routing check** with `READ_DATABASE_URL` pointed at the same clone (a code path, not a replica):
  - a closed-range revenue report answered with `db-read;desc="replica=1"`, and one including today with `primary=1`;
  - with an unreachable `READ_DATABASE_URL`, the closed-range report answered `fallback=1` (200) and `ops:db-check` warned "unreachable".

### 35.7 Browser QA (production build, local TLS proxy, headless Chrome; `READ_DATABASE_URL` set to the same clone, so routing is active)

- **Reservations:** a new booking was visible at once on its page and in front-desk arrivals.
- **Availability:** the room type went from 56 to 55 available.
- **Check-in:** the room board showed the room OCCUPIED at once.
- **Charge:** the folio went from 0.0000 to 29.0000 (25.00 + tax). The billing page showed it, and today's revenue report went from 0 to 2 lines, 29.0000 (`primary=1`).
- **Guest note:** visible at once.
- **Reports:** a closed-range report loaded through the replica (`replica=1`).
- **Night audit:** the readiness page loaded.
- **Console:** no page exceptions; no visible difference from the primary-only setup.

### 35.8 Connection budget

| Connection                         | Where            | Count                                                                                                      |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Application pool                   | primary          | instances × `DATABASE_POOL_MAX` (10)                                                                       |
| LISTEN (live updates, job wake-up) | primary, direct  | up to 2 per instance                                                                                       |
| Worker processes                   | primary          | as instances                                                                                               |
| Read pool                          | **replica only** | instances × `READ_DATABASE_POOL_MAX` (3), only when `READ_DATABASE_URL` is set; opened lazily, idle-closed |
| Operations, backups, migrations    | primary          | ≈ 10 reserved                                                                                              |

The replica pool never adds to the primary's budget, unless `READ_DATABASE_URL` points at the primary by mistake. `ops:db-check` then warns "not a standby".

### 35.9 When to enable a replica, and what remains (PROPOSED)

- **Enable it when:**
  - PostgreSQL CPU on the primary is regularly above ≈ 60–70 %, while instances are not the limit;
  - **or** closed-date reporting or exports measurably slow operations, beyond the per-process slot of §33.6.
- **Prerequisites:**
  - a streaming standby on its own host;
  - a read-only role (`default_transaction_read_only`, `SELECT` grants);
  - `hot_standby_feedback` or a `max_standby_streaming_delay` long enough for report statements;
  - the replica's `max_connections` sized for instances × 3;
  - monitoring of replay lag.
- **Remaining bottlenecks** (**MEASURED** above):
  - **Guest search:** 41 % of PostgreSQL CPU and 284 k rows read per request. It must stay on the primary, and needs a query or index fix. **Done in phase 8 (§36):** −72 to −90 % CPU per search.
  - **The single-threaded application instance:** throughput plateaus at ≈ 135–147 req/s per instance, with PostgreSQL at a quarter of its CPU.
  - **Room board, arrivals and reservation search:** together ≈ 30 % of database CPU.
- **Not claimed:** 100 000 requests per second.

## 36. Guest search

### 36.1 The path and the root cause (MEASURED; clone `serene_bench_na4`: 300,000 guests in one organization, 45 surnames × 34 first names)

**The path:**

1. The guest list or the global search palette calls `GET /api/v1/guests?q=&status=&limit=&cursor=` (a session route, organization-wide).
2. `searchGuests` (guests.service) checks `guests:read`. A confirmation-number lookup is limited to properties with `reservations:read`.
3. The repository's `searchGuests` runs one Prisma `findMany` (plus a second statement for VIP levels):
   - **filter:** `organization_id AND status AND deleted_at IS NULL AND (every name word in search_name OR e-mail = OR listed e-mail EXISTS OR phone digits contain OR profile number = OR confirmation guest ids)`;
   - **order:** `ORDER BY last_name, first_name, id`, keyset cursor, `LIMIT n+1`.
4. Global search calls the same function with limit 5.

**Root cause, from `EXPLAIN (ANALYZE, BUFFERS)`:**

- PostgreSQL chose the name index (`organization_id, last_name, first_name`) to avoid a sort, and tested every guest in name order against the OR until it had `n+1` matches.
- `search_name` is "last first", so the guests matching a surname sit together in that order. Everything alphabetically before them was read and discarded: "khan" removed 135,003 rows (135 k buffers, 89 ms); "smith" read 248 k buffers; "zhang" 293 k.
- A full name, or an e-mail (one match), walked the entire table: 300 k buffers, 0.25 s and 2.5 s.
- Page 2 repeated the walk: the cursor's OR form cannot start an index range.
- Rare and no-match terms were cheap: the planner then picked the trigram bitmap.
- This was ≈ 41 % of PostgreSQL CPU in the default mix (§35.2).

### 36.2 Change (`modules/guests/guests.repository.ts`, one raw statement; no index, migration, rule or API change)

With search terms, one statement takes the cheapest of three exact paths, each gated by a one-time filter:

1. **Few matches.** Each OR branch runs on its own index (trigram name and phone, e-mail, listed e-mail, profile number, ids), `UNION ALL`, capped at 1,001 rows. If 1,000 or fewer exist, the page is sorted from them, deduplicated.
2. **Many matches, early in name order.** The first 3,000 guests of the organization after the cursor, in page order, filtered by status, deletion and the same OR. If at least `n+1` match, they are the page. This is exact: every guest beyond the window sorts after all of them. The window starts at the cursor with a row comparison `(last_name, first_name, id) > (…)`, equivalent to the OR form because the columns are NOT NULL.
3. **Otherwise.** Every match by branch, `UNION`-deduplicated, then sorted.

- The VIP level is joined in the same statement, so a search takes 1 statement instead of 2. The list without a term keeps the Prisma query unchanged.
- **Sizes.** 1,000 and 3,000 come from the measurements below. A window-only variant (§36.3) made rare terms pay for the window; candidate-first-only made broad early terms sort tens of thousands of rows.
- **Indexes.** Every branch already had one: `guests_search_name_trgm_idx`, `guests_phone_digits_trgm_idx`, `guests_organization_id_primary_email_idx`, `guest_contacts_type_value_idx`, `guests_organization_id_profile_number_key`, and `guests_organization_id_last_name_first_name_idx` for the window and the cursor. No new index was needed.

### 36.3 Candidates compared (MEASURED, `EXPLAIN ANALYZE`, best of 3, limit 11, 22 terms)

| Statement                          | Sum over the 22 terms | Weak spot                                                                                                                                                               |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| previous (ordered walk with OR)    | 4,960 ms              | late-alphabet surnames, full names, e-mail (up to 2.4 s)                                                                                                                |
| candidate-first, join back by id   | —                     | hash-joined all 300 k guests (≈ 500 ms per common term)                                                                                                                 |
| candidate-first, full rows         | —                     | broad early terms sort every match ("ma" 2.5 → 409 ms)                                                                                                                  |
| window 3,000, then candidates      | 875 ms                | rare / no-match / profile / phone pay the window (0.1 → 8 ms). Status INACTIVE walked the whole index (1.6 → 43 ms CPU/request in load), fixed by windowing by position |
| **cap 1,000 → window 3,000 → all** | —                     | broad early terms ("ava", 2-letter "ma") pay the capped pass (below)                                                                                                    |

### 36.4 Before / after (MEASURED; one `next start`, pool max 10, `SERVER_TIMING=1`; users loop for 45 s (mix) or 15–20 s (single term))

**Guest-search mix** (the k6 terms khan, ahmed, smith, malik, zhang, fatima, omar, wilson, haddad, rahman; limit 10):

| Users | req/s        | p50 / p95 / p99 ms                  | PG CPU (8 cores) | PG CPU ms / req | Buffers / req | Rows read / req | Pool wait p95 ms | Statements / req |
| ----- | ------------ | ----------------------------------- | ---------------- | --------------- | ------------- | --------------- | ---------------- | ---------------- |
| 1     | 5.2 → 25.4   | 179 / 396 / 462 → 36 / 70 / 91      | 81 → 41 %        | 155.8 → 16.1    | 143 k → 4.0 k | 287 k → 28 k    | 0.2 → 0.1        | 2 → 1            |
| 8     | 25.2 → 97.6  | 311 / 638 / 802 → 78 / 142 / 164    | 653 → 464 %      | 259.1 → 47.5    | 143 k → 3.9 k | 285 k → 28 k    | 0.2 → 0.1        | 2 → 1            |
| 16    | 31.0 → 99.7  | 513 / 949 / 1165 → 142 / 284 / 363  | 636 → 544 %      | 205.2 → 54.6    | 143 k → 3.9 k | 285 k → 28 k    | 327 → 72         | 2 → 1            |
| 32    | 33.6 → 103.8 | 924 / 1438 / 1625 → 296 / 442 / 514 | 646 → 555 %      | 192.3 → 53.5    | 143 k → 3.9 k | 285 k → 28 k    | 867 → 248        | 2 → 1            |

- Throughput ×3–5; p95 and p99 −65 to −82 %; PostgreSQL CPU per search −72 to −90 %; buffers per search ÷ 37.
- Connections stay at the pool's 10 under saturation (avg 9.7 → 9.2); no spikes.

**Single terms** (1 user / 8 users; PG CPU ms per request):

| Search                            | req/s at 8 users | p95 ms at 8 users | PG CPU ms / req (1 user) | Buffers / req   |
| --------------------------------- | ---------------- | ----------------- | ------------------------ | --------------- |
| exact name "Ava Haddad"           | 18.4 → 193.6     | 529 → 57          | 200 → 1.6                | 302,771 → 518   |
| e-mail                            | 2.3 → 318.1      | 3,605 → 35        | 1,800 → 3.1              | 319,557 → 338   |
| surname "haddad"                  | 59.8 → 125.2     | 191 → 85          | 47.9 → 16.8              | 91,145 → 3,870  |
| common "khan"                     | 40.8 → 133.6     | 303 → 84          | 82.1 → 15.4              | 136,539 → 3,945 |
| rare "rossi"                      | 389 → 399        | 29 → 27           | 1.4 → 1.6                | 237 → 240       |
| no match                          | 430 → 378        | 25 → 37           | 0.8 → 1.9                | 232 → 235       |
| profile number                    | 426 → 353        | 26 → 31           | 1.4 → 1.8                | 281 → 287       |
| phone digits                      | 339 → 335        | 32 → 33           | 0.8 → 1.4                | 329 → 331       |
| multi-word "noor al mansouri"     | 359 → 326        | 29 → 36           | 2.1 → 2.2                | 546 → 547       |
| status INACTIVE                   | 301 → 285        | 43 → 42           | 3.1 → 4.3                | 686 → 685       |
| list, no term (Prisma, unchanged) | 404 → 381        | 27 → 29           | 1.1 → 1.3                | 478 → 482       |
| first name "ava" (broad, early)   | 245 → 178        | 48 → 59           | 2.6 → 3.8                | 8,758 → 2,220   |
| 2 letters "ma" (broad, early)     | 373 → 274        | 29 → 44           | 1.7 → 1.8                | 2,237 → 2,329   |

- **What got cheaper.** Terms whose matches are late in name order, full names and e-mail are the ones that used to read the table. Full names and e-mail now cost 125–580× less database time; common surnames 3–5× less.
- **What did not change.** Selective terms stay within ≈ 1 ms of their former database time. Their 8-user throughput differs by −17 % to +3 %, within the run-to-run noise of this host (§33.6).
- **The measured cost.** Broad terms that match early in name order ("ava", "ma") pay the capped candidate pass. They were already cheap, and remain so in absolute terms (p95 ≤ 59 ms at 8 users), but their 8-user throughput is 25–27 % lower.

### 36.5 Global search (MEASURED; `search-guests` Server-Timing entry)

| Request                               | Users | req/s         | p95 ms    | PG CPU ms / req | Guest share of server time | Guest source p50 ms |
| ------------------------------------- | ----- | ------------- | --------- | --------------- | -------------------------- | ------------------- |
| organization search, common terms     | 1     | 8.4 → 25.8    | 254 → 70  | 82.1 → 15.1     | 95 % → 87 %                | 95.7 → 22.1         |
| organization search, common terms     | 8     | 35.6 → 105.8  | 510 → 132 | 173.6 → 42.6    | 96 % → 86 %                | 202.3 → 55.8        |
| organization search, rare term        | 8     | 297.8 → 306.0 | 39 → 36   | 1.2 → 1.9       | 46 % → 40 %                | 8.2 → 7.1           |
| organization search, no match         | 8     | 340.9 → 324.1 | 32 → 34   | 1.2 → 1.4       | 45 % → 41 %                | 7.1 → 6.8           |
| property search (all sources), common | 1     | 5.9 → 8.3     | 277 → 252 | 115.3 → 67.5    | 73 % → 35 %                | 116.8 → 36.9        |
| property search (all sources), common | 8     | 14.8 → 20.9   | 856 → 798 | 317.6 → 165.1   | 60 % → 28 %                | 317.5 → 76.7        |

Guest search was 95 % of the organization search's time for common names, and is now 4× faster. The property search is now dominated by its other sources (§36.9).

### 36.6 Result equivalence (MEASURED)

- **Benchmark clone.** 149 searches compared page by page against the previous implementation (kept verbatim as the oracle), along cursor chains of up to 25 pages: 7,162 pages, 148,150 rows, **0 differences**. The searches covered every surname and first name, 2-letter prefixes, full names, profile numbers in both cases, e-mails, phone digits, no-match, digit strings, accents, apostrophes and confirmation ids; both statuses; page sizes 5, 10 and 50.
- **`tests/integration/guest-search.test.ts`.** The same oracle over more than 1,000 pages:
  - **searches:** 30 searches incl. overlapping branches, × 2 statuses × 3 page sizes × 7 (window, cap) pairs, which force each of the three paths on small data;
  - **response contract:** fields, values, VIP object, `fullName`, the cursor (14 distinct guests over 4-per-page pages, no duplicate) and the empty `nextCursor`;
  - **list without a term:** unchanged.
- **Mutation check.** Each of these deliberate faults makes the tests fail:
  - the cursor dropped from the branches;
  - `>` turned to `>=` in the row-comparison cursor;
  - the window without the cursor;
  - the deleted-guest filter dropped;
  - the window threshold `>=` turned to `>`;
  - the cap off by one;
  - the deduplication of the capped path removed (caught after a guest matching two branches was added).

### 36.7 Isolation and permissions (MEASURED; integration tests)

- Guests are organization data: the organization filter is part of every branch, the window and the final rows.
- **Excluded from results:** another organization's guest with the same name, another organization's guest whose e-mail equals a listed contact here, confirmation ids of another organization's guest, inactive and deleted guests.
- **Access:** an organization-wide manager, a single-property front desk agent and a user with `guests:read` at another property only all search the organization's guests, as before. A user without `guests:read` gets 403.
- **Confirmation numbers** still resolve only in properties where the caller may read reservations (service unchanged; `profiles.test.ts`).
- **Inactive properties:** their reservations are not readable, so they are not searchable by confirmation (unchanged).
- **Personal data.** The response still carries e-mail and phone: the guest list shows them in each row (`GuestsPanel`). The contract is unchanged. Global search maps its own minimal result.

### 36.8 Browser QA (production build, local TLS proxy, headless Chrome, clone)

- **Searching:** the guest list loaded; "khan" showed 20 rows. Next to page 2, page 3, and back with Previous gave the same pages. "aisha khan" (multi-word) and "zzqx" ("No guest matches") behaved as before.
- **Rapid typing:** "haddad" typed at 60 ms per key sent one request (debounced) with the right results.
- **Property switching:** SMR → SDX shows the same organization-wide results.
- **Global palette:** "khan" shows its Guests group (5) beside Reservations and Folios.
- **Permissions:** a single-property front desk agent searches normally; a housekeeper sees "Access denied — You need the guests:read permission" (API 403).
- **Console:** no page exceptions; the only console error is that deliberate 403.

### 36.9 Remaining (MEASURED unless marked)

- **Broad terms early in name order** ("ava", 2-letter prefixes) pay the capped candidate pass (up to ≈ 2 k buffers). 2-letter terms cannot use the trigram index at all; the worst case is a late 2-letter prefix (≈ 130 ms, against ≈ 300 ms before).
- **Guest search remains the costliest guest-facing query per request** (≈ 16 ms of PostgreSQL CPU in the mix at 1 user). A cache is not proposed: profiles change at the desk and must be found at once (read-your-writes), and query work removed 70–90 % of the cost.
- **The property global search** is now dominated by its other sources: reservations, folios, companies, groups and maintenance (≈ 23 transactions per request). Next candidates, with the room board, arrivals and reservation search (§35.2).
- **Not claimed:** 100,000 requests per second.

## 37. Horizontal scaling: several stateless instances behind a load balancer

Phase 9 prepares the application to run as several identical Next.js processes behind a health-aware load balancer, without sticky sessions. Everything here was measured on one development machine:

- Intel i5-8365U, 4 cores / 8 threads, Windows 11;
- native PostgreSQL 18;
- clone `serene_bench_na5`.

App instances, PostgreSQL, the load generator and the test load balancer **share the same 8 threads**. Throughput numbers therefore show same-host CPU contention, not what separate hosts would deliver.

No cloud deployment was made, and no Docker. **Not claimed:** 100,000 requests per second.

### 37.1 State audit

| State                                                             | Where                                                                       | Class                                    | Multi-instance consequence                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sessions, refresh-token rotation, revocation                      | `sessions`, resolved on every request and never cached                      | DATABASE-BACKED                          | Login on A, request on B, logout anywhere: effective everywhere at once (§37.5)                     |
| Access tokens                                                     | Signed cookie (`__Host-sm_at`) with a shared secret                         | CLIENT-LOCAL (verified by every process) | Every instance needs the same `AUTH_*` secrets; the session row is still checked per request        |
| Permissions, role grants                                          | `user_role_assignments`, loaded per request                                 | DATABASE-BACKED                          | No authorization decision depends on the instance                                                   |
| Rate limits                                                       | `rate_limit_windows` (`RATE_LIMIT_STORE=postgres`, the default)             | DATABASE-BACKED                          | Budgets are shared (§37.6). `memory` would be PROCESS-LOCAL: never use it with more than 1 instance |
| Background jobs                                                   | `background_jobs`, with leases and fencing                                  | DATABASE-BACKED                          | Any number of workers, no duplicates (§37.7)                                                        |
| Live-update fan-out                                               | `pg_notify` → one LISTEN per instance                                       | SHARED (PostgreSQL)                      | An event made on A reaches streams on B (§37.4)                                                     |
| Open event streams and their subscribers                          | Process memory (`RealtimeHub`)                                              | PROCESS-LOCAL                            | Lost with the process; the client reconnects anywhere                                               |
| In-flight request count, draining flag, instance id               | `globalThis.__sereneLifecycle`                                              | PROCESS-LOCAL                            | Observability and shutdown only                                                                     |
| Heavy-report slots (`REPORT_HEAVY_CONCURRENCY`), search semaphore | Process memory                                                              | PROCESS-LOCAL                            | Per-process protection; the cluster-wide limit is instances × slots                                 |
| Read-replica health                                               | Process memory, 10 s probe                                                  | PROCESS-LOCAL                            | Each instance decides on its own; reads fall back to the primary                                    |
| Database pools                                                    | Process memory: two per process with the inline worker (§37.10)             | PROCESS-LOCAL                            | Counted in the connection budget                                                                    |
| Next.js build output, static assets                               | `.next/` on each host                                                       | PROCESS-LOCAL (identical per release)    | Every instance must run the same build; hashed asset names make mixed releases safe (§37.12)        |
| Uploads / file storage                                            | None: the application stores no files, and exports stream from the database | —                                        | Nothing to share                                                                                    |
| Offline snapshots, UI state                                       | IndexedDB, Cache Storage, Zustand                                           | CLIENT-LOCAL                             | Independent of the instance                                                                         |
| Audit logs, ledgers                                               | Append-only tables                                                          | DATABASE-BACKED                          | —                                                                                                   |
| Mail (password reset)                                             | SMTP provider                                                               | EXTERNAL                                 | Same configuration on every instance                                                                |

**Statelessness proof (MEASURED).** Requests were spread round-robin, without affinity, over 2, 4 and 8 instances. This covered sessions, rate limits, event streams, jobs and the whole browser workflow (§37.5–§37.7, §37.14). No result depended on which instance served a request.

### 37.2 Health and the load-balancer contract

- **`/api/health/live`** never touches PostgreSQL.
- **`/api/health/ready`** runs `SELECT 1` (2 s timeout) and answers 503 `draining` during shutdown.
- Both are unauthenticated and `no-store`.
- **With `SERVER_TIMING=1`:**
  - the readiness body adds `instance`, uptime, draining, in-flight requests, open streams, LISTEN state and worker activity;
  - every API response carries `x-instance-id`;
  - none of this includes secrets or addresses.
- **Full contract** (health checks, no affinity, unbuffered streams, timeouts, retries, forwarded headers): OPERATIONS §10.

### 37.3 Graceful shutdown (`lib/lifecycle`, `scripts/start.mjs`)

By default, Next.js 16 `next start` closes its HTTP server immediately on SIGTERM/SIGINT. It does not when `NEXT_MANUAL_SIG_HANDLE=true`, which must be set before Next.js starts. `npm start` therefore now runs `scripts/start.mjs`, which sets it and then starts `next start`.

The application then owns the shutdown sequence (OPERATIONS §10):

1. Readiness answers 503.
2. The job worker stops claiming; open streams receive `reauth {reason:"shutdown"}` and end.
3. The instance keeps serving for `SHUTDOWN_DRAIN_MS`.
4. It waits for in-flight API requests.
5. It closes LISTEN and every pool, then exits 0.

The whole sequence is bounded by `SHUTDOWN_TIMEOUT_MS`, plus a hard exit 5 s later. On Windows, Ctrl+Break (SIGBREAK) is handled too, because Next.js never handles it.

Each Prisma client registers its own pool close (`lib/db/prisma.ts`). This phase found that the job worker's bundle has its own pool, which the first version of the shutdown hook did not reach. (Superseded in the final phase, §38.2: a production process actually loads the module in three bundles, and they now share one pool, closed once.)

**MEASURED (one instance, 3 s drain, real signal):**

- Readiness returned 503 within 847 ms of the signal; this includes launching the signal sender.
- Liveness stayed 200 throughout.
- The open stream received `reauth {"reason":"shutdown"}` and ended.
- A 2–3 s report started before the signal finished with 200.
- All 8 requests sent during the drain answered 200.
- The process exited 4.5 s after the signal; its log reads "in-flight requests finished … closed after 3045 ms".

Under load behind the load balancer: §37.9.

### 37.4 Live updates across instances (MEASURED)

Each instance holds one LISTEN connection, and commands on any instance call `pg_notify`. Room commands were sent round-robin, with one stream open per instance:

| Instances | Deliveries | Cross-instance | Missing | p50    | p95    |
| --------- | ---------- | -------------- | ------- | ------ | ------ |
| 2         | 32 / 32    | 16             | 0       | 208 ms | 213 ms |
| 4         | 64 / 64    | 48             | 0       | 206 ms | 214 ms |
| 8         | 128 / 128  | 112            | 0       | 211 ms | 221 ms |

About 200 ms of that latency is the stream's deliberate 200 ms merge window.

A first 2-instance attempt had 1 command answer 422 and delivered 30 of 32 events. It ran with stale test sessions, after the rate-limit run had used up the login budget. Its cause was not investigated further; the row above is the re-run with fresh sessions.

**When a relay becomes necessary (ESTIMATED).** PostgreSQL delivers each notification to every listener. The cost is one LISTEN connection per instance, and one delivery per instance per commit. That stays negligible into dozens of instances.

A separate relay (Redis pub/sub, NATS) becomes worth it in either case:

- there are more instances than the connection budget can give LISTEN connections (they stay direct even behind PgBouncer);
- notification volume reaches thousands per second.

Neither applies to the measured workload.

### 37.5 Sessions across instances (MEASURED, 8 instances)

**Steps that must succeed:** login on A, `/me` on B, refresh on C, then `/me` with the refreshed token on B. All returned 200.

**After logout on A, all returned 401:**

- the revoked access token on B;
- the pre-refresh token on B;
- the old refresh token on C.

A foreign `Origin` is refused with 403 on every instance.

During the rolling update (§37.11), the same sequence passed across versions, both old→new→old and new→old→old. Nothing caches session validity, so revocation has no window.

### 37.6 Rate limits across instances (MEASURED)

Requests were sent round-robin over 1, 2, 4 and 8 instances, and the counts were identical every time:

| Limit                                                                                                       | Allowed before 429 (1 / 2 / 4 / 8 instances) |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Login, one account, changing IPs                                                                            | 10 / 10 / 10 / 10                            |
| Login, one IP, changing accounts                                                                            | 20 / 20 / 20 / 20                            |
| Password reset completion, one IP                                                                           | 10 / 10 / 10 / 10                            |
| Forged `X-Forwarded-For`/`X-Real-IP`/`Forwarded` on every request, through an appending proxy (3 instances) | 20: the real peer is limited                 |

### 37.7 Job workers across instances (MEASURED)

Each instance ran its inline worker with concurrency 1. The crash-recovery test started from 200 jobs left RUNNING under a dead worker, with their leases expired.

| Instances | 1,000 short jobs (2 runs) | Workers claiming | Re-executed | Crash recovery: all reclaimed and finished exactly once more |
| --------- | ------------------------- | ---------------- | ----------- | ------------------------------------------------------------ |
| 1         | 75.0, 73.6 jobs/s         | 1                | 0           | 28.1 s                                                       |
| 2         | 135.3, 114.3 jobs/s       | 2                | 0           | 17.5 s                                                       |
| 4         | 155.0, 171.3 jobs/s       | 4                | 0           | 10.5 s                                                       |

With old and new releases mixed (300 jobs), 3 workers were claiming and 0 jobs were re-executed.

Crash recovery time is bounded by the reclaim batch (50 per pass) and the retry backoff, not by how many jobs were lost.

### 37.8 Throughput at 1, 2 and 4 instances (MEASURED, same host)

Setup:

- k6 closed model, default mix, 45 s per point, round-robin over the instances;
- 40 event streams held open throughout;
- `DATABASE_POOL_MAX` 10.

| Instances | Users | req/s | p50    | p95      | p99      | Errors | Pool wait p95 | PostgreSQL CPU | App CPU (all node) | DB active avg | DB connections max |
| --------- | ----- | ----- | ------ | -------- | -------- | ------ | ------------- | -------------- | ------------------ | ------------- | ------------------ |
| 1         | 16    | 95.0  | 148 ms | 325 ms   | 473 ms   | 0 %    | 162 ms        | 130 %          | 44 %               | 2.3           | 13                 |
| 1         | 64    | 113.9 | 442 ms | 1,192 ms | 1,383 ms | 0 %    | 1,732 ms      | 111 %          | 45 %               | 2.4           | 13                 |
| 2         | 16    | 119.4 | 115 ms | 289 ms   | 412 ms   | 0 %    | 47 ms         | 291 %          | 108 %              | 3.6           | 26                 |
| 2         | 64    | 132.9 | 374 ms | 1,417 ms | 1,709 ms | 0 %    | 1,587 ms      | 278 %          | 103 %              | 3.8           | 26                 |
| 4         | 16    | 126.0 | 99 ms  | 282 ms   | 599 ms   | 0 %    | 8 ms          | 384 %          | 169 %              | 5.3           | 52                 |
| 4         | 64    | 132.2 | 362 ms | 1,263 ms | 1,804 ms | 0 %    | 833 ms        | 382 %          | 167 %              | 8.3           | 52                 |

CPU is a percentage of one thread, so 800 % is the whole machine.

**Reading the table:**

- **A second instance** removes most of the single-process pool wait at 16 users (162 → 47 ms) and adds 26 % throughput.
- **A fourth instance** adds only another 6 %.
- **At 64 users** all three configurations plateau at 114–133 req/s, while PostgreSQL rises to about 3.8 threads and the instances to about 1.7. The machine has 8 threads and also runs k6, so the plateau comes from the shared host.
- **On separate hosts (ESTIMATED from the table)** more instances would be limited by PostgreSQL CPU, about 30 ms per request at this mix, not by the instances.

Worker throughput is in §37.7. All 40 event streams stayed open throughout.

### 37.9 Failover under load (MEASURED)

Setup:

- 2 instances behind the test load balancer;
- k6 with 16 users;
- 10 reconnecting event streams;
- one job inserted every 100 ms;
- probes every 50 ms.

| Event                 | Load-balancer removal                                 | Probe errors | k6 failures | Streams reconnected        | Jobs                             |
| --------------------- | ----------------------------------------------------- | ------------ | ----------- | -------------------------- | -------------------------------- |
| Hard kill (forced)    | First connection error, ≈ 0.5 s after the kill landed | 0 / 136      | 0 / 2,654   | 5 of 5 dropped, 250–290 ms | 252 / 252 finished, 0 duplicates |
| Graceful (Ctrl+Break) | Readiness 503 after 2 checks, ≈ 2 s into the drain    | 0 / 136      | 0 / 2,698   | 5 of 5, 209–1,114 ms       | 247 / 247 finished, 0 duplicates |

- **Sessions** stayed valid: the probes were authenticated. Rate limits are shared by construction (§37.6).
- **Retries:** the load balancer retried GET probes that hit the dead target once. It did not retry writes, and no write failed in these runs.
- **Writes in flight during a hard kill (NOT MEASURED as a separate case):** they would fail with 502, and must not be retried automatically.
- **Jobs:** the killed instance happened to hold no job at the moment of the kill, since jobs take about 5 ms. A job held by a dead worker is recovered through lease expiry (§37.7): at most `JOB_LEASE_MS` (60 s) plus backoff late, never lost and never doubled.

### 37.10 Connection budget (`connectionBudget`, `lib/db/pool-config.ts`; `npm run ops:db-check`)

**Per web instance, worst case:**

- `DATABASE_POOL_MAX` for the process's pool (shared by every server bundle since the final phase);
- 1 for the realtime LISTEN;
- with `JOB_WORKER=inline`, 1 for the worker's LISTEN. (Corrected in the final phase, §38.2: phase 9 counted a second pool for the worker's bundle; there were in fact three pools per process, now one shared pool.)

**Separate worker processes:** `DATABASE_POOL_MAX` + 1 each.

**Usable connections:** `max_connections` − superuser reserve (3) − 10 for migrations, backups, monitoring and administrators. One instance of surge headroom is kept free for rolling updates.

Instances that fit:

| `max_connections` | inline, pool 10 | inline, pool 5 | `JOB_WORKER=off` + 1 worker, pool 10 | off + 1 worker, pool 5 | off + 2 workers, pool 5 |
| ----------------- | --------------- | -------------- | ------------------------------------ | ---------------------- | ----------------------- |
| 100 (default)     | 6               | 11             | 5                                    | 12                     | 11                      |
| 200               | 14              | 25             | 15                                   | 29                     | 28                      |
| 400               | 31              | 54             | 33                                   | 62                     | 61                      |

- **`ops:db-check` on the development server (MEASURED, final phase):** "max_connections=100 (87 usable after reserves), up to 12 per instance … → at most 6 instances plus 1 during a rolling update". In phase 9 it printed 22 and 2 under the superseded formula.
- **Steady state is far below the worst case (MEASURED):** 13 connections per instance under 64 users, 52 for 4 instances.
- **The 8-instance tests** stayed under `max_connections` only because the pools were mostly idle. Eight instances is not a supported configuration at the defaults.
- **Recommendation (PROPOSED):**
  - **Beyond 2 instances:** set `JOB_WORKER=off` on the web instances and run 1–2 `npm run worker` processes. Lower `DATABASE_POOL_MAX` to 5 when more than 6 instances are planned; the measured active average is 2–5 per instance (§38).
  - **Beyond about 10–12 instances:** use PgBouncer in transaction mode (OPERATIONS §6).
  - **`max_connections`:** raise it only deliberately, accounting for memory, and never to improve a benchmark.

### 37.11 Rolling update and rollback (MEASURED)

The previous release (`7023cf5`, which has no lifecycle code) and the current tree ran side by side behind the load balancer for 170 s. Load during the whole run:

- k6 with 8 users;
- probes;
- 10 reconnecting streams;
- a job feed.

**Sequence:**

1. Start with old 1 and old 2.
2. Add new 3.
3. Retire old 1: deregister, wait 3 s, stop.
4. Add new 4.
5. Retire old 2.
6. Roll back: add old 1b, gracefully stop new 3, add old 2b, gracefully stop new 4.

**Results:**

- **Load:** k6 failed 0 of 13,042 requests (p95 216 ms); probes had 0 errors out of 1,488; streams reconnected in 150–400 ms; 1,399 jobs ran with 0 duplicates.
- **Mixed releases:** sessions worked old↔new in both directions; live updates crossed old↔new (16/16); jobs on old and new workers had 0 duplicates.
- **Migrations:** 27 applied before and after, and no instance log mentions a migration. Migrations are a separate, single step (DEPLOYMENT §4); this release has no migration.

### 37.12 Static assets, storage

`next build` content-hashes `/_next/static/*`, so a page already open in a browser keeps loading its own assets from any instance of the same release.

During a mixed rollout, a page from the new release can request a new chunk from an old instance and get 404 for the seconds both run. This was NOT MEASURED as a failure in §37.11, because the browser QA navigated only after the rollout. To avoid it, serve `/_next/static` for both releases from every instance, or from a CDN or shared directory that keeps the previous release's files.

No user files are stored.

### 37.13 Forwarded headers, timeouts, observability, security

- **Forwarded headers.**
  - Only `X-Forwarded-For` is read, using `TRUSTED_PROXY_HOPS` entries from the right; `X-Real-IP` and `Forwarded` are ignored.
  - MEASURED through an appending proxy: forged values on every request did not change the identity being limited (§37.6).
  - Instances must not be reachable except through the proxy.
- **Application timeouts:**
  - database connect 5 s;
  - statement 30 s;
  - interactive transaction 15 s (night audit 300 s, inside a job);
  - heavy-report slot wait 30 s;
  - stream heartbeat 25 s, and stream lifetime at most 15 min;
  - shutdown drain 5 s, bounded at 25 s;
  - job lease 60 s.
- **Load-balancer timeouts must fit these:**
  - request timeout above 60 s;
  - stream idle timeout above 25 s;
  - upstream keep-alive idle timeout **shorter** than Node's. `next start` defaults to 5 s; behind a balancer with a 60 s idle timeout, raise it with `npm start -- --keepAliveTimeout 65000`. Otherwise reused connections race with Node closing them.
- **Observability:**
  - `INSTANCE_ID`, `x-instance-id` (with `SERVER_TIMING=1`), the readiness body and `[shutdown <id>]` log lines;
  - PostgreSQL connections are named by `application_name`: `serene-management`, `-realtime` and `-jobs`;
  - none of it includes secrets, connection strings or addresses.
- **Security across instances (MEASURED, 3 instances).** A user scoped to one property signed in on A:
  - the other property's event stream on B: 403;
  - the other property's business date on C: 403;
  - their own property: 200;
  - someone else's job: 404;
  - their own job at the inaccessible property: 404;
  - their own job at their property: 200;
  - a role change made in the database ended the user's stream on C with `reauth {"reason":"access"}` within 21 ms, and the next request on B returned 403;
  - a logout on A ended the session's stream on B within 67 ms.

### 37.14 Browser QA (MEASURED)

Setup: production build, headless Chrome → local TLS proxy → appending load balancer → 2 instances, `TRUSTED_PROXY_HOPS=2`.

**Covered:**

- login;
- front desk, reservations, housekeeping, billing, reports, night audit, guests, availability, and the room board (front desk rooms);
- property switch SMR → SDX;
- global search: "khan" returned Reservations 5, Guests 5, Folios 5;
- sign-out, after which `/me` returns 401.

**Results:**

- **Load spread:** 198 API responses, 88 from one instance and 110 from the other.
- **Errors:** no page exceptions and no console errors.
- **Instance stop:** the instance holding the page's event stream was stopped. The stream's 2 reconnect attempts got 503 while that instance drained, the third opened on the other instance, and navigation continued there.
- **Offline:** "Offline mode" was shown and the data kept. Back online, the stream reopened with no errors.
- **Streams:** one stream per tab was confirmed on the instance. A stream leak seen at first was in the test TLS proxy, which did not abort the upstream connection when the client disconnected. That is why OPERATIONS §10 requires the load balancer to do so.

### 37.15 Production topology (PROPOSED)

```
clients ── HTTPS ──> reverse proxy / load balancer
                       (TLS; appends X-Forwarded-For; health-checks /api/health/ready; no affinity;
                        unbuffered /events; aborts upstream on client disconnect)
                       └──> web instances 1..N  (npm start; INSTANCE_ID set; JOB_WORKER=off beyond 2 instances)

web instances, worker processes 1..2 (npm run worker)
  ── pools (direct, or PgBouncer in transaction mode) ──> PostgreSQL primary
web instances ── 1 LISTEN each (always direct) ─────────> PostgreSQL primary
optional: closed-date reports ──────────────────────────> streaming standby (§35)
once per release: npm run db:deploy (schema owner), never from the instances
```

### 37.16 Autoscaling signals (PROPOSED, not implemented)

- **Scale out web instances** when one of these holds for 5 min:
  - instance CPU above 70 %;
  - p95 above the latency target while PostgreSQL CPU is below 60 %;
  - pool wait p95 (Server-Timing `db-wait`) above 50 ms while PostgreSQL CPU is below 60 %.
- **Do not scale out** when PostgreSQL CPU is the limit (above 70 %): more instances only add connections and contention (§37.8).
- **Upper bound:** the connection budget (§37.10), not CPU.
- **Scale in:** send SIGTERM to one instance at a time, and readiness drains it (§37.3). Streams reconnect, and there is no stickiness to preserve.
- **Workers:** scale on `oldestDueSeconds` above 60 s (from `npm run worker -- --stats`), not on CPU.
- **Streams:** open streams per instance (in the readiness body) is a capacity signal, not a scaling trigger. Each stream costs memory only, not a database connection.

### 37.17 Failure modes

| Failure                                                 | Effect                                                                          | Recovery                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Instance crash                                          | Its in-flight requests fail (the balancer retries GETs); its streams drop       | The balancer removes it on connection errors, clients reconnect (≈ 0.3 s, §37.9), and its jobs are re-claimed after lease expiry |
| Instance stopped gracefully                             | Nothing visible (§37.9)                                                         | —                                                                                                                                |
| Instance alive, database unreachable                    | Readiness 503 `unavailable`, liveness 200                                       | The balancer stops routing to it; do not restart it (DEPLOYMENT §6)                                                              |
| LISTEN connection lost on one instance                  | Its streams get `degraded`, and clients fall back to polling                    | The hub reconnects and `live` resumes                                                                                            |
| PostgreSQL restart                                      | No instance is ready; jobs fail and retry with backoff                          | Automatic once connections return                                                                                                |
| Load-balancer health checks too slow                    | Requests reach a draining instance                                              | They are still served during `SHUTDOWN_DRAIN_MS`; keep the drain ≥ check interval × unhealthy threshold                          |
| Connection budget exceeded                              | New connections fail (`53300`); requests answer 500/503                         | Lower pool sizes, use separate workers, or add PgBouncer (§37.10)                                                                |
| Mixed releases with an incompatible migration           | Old instances fail on the new schema                                            | Ship only expand/contract migrations in rolling releases (DEPLOYMENT §4)                                                         |
| Proxy that does not abort upstream on client disconnect | Event streams stay open on the instances until their next heartbeat write fails | Configure the proxy (OPERATIONS §10)                                                                                             |

### 37.18 Remaining (NOT MEASURED)

- Separate hosts: the ≈ 130 req/s plateau belongs to this machine.
- A real nginx, HAProxy or cloud load balancer: a 90-line test balancer was used.
- Network partitions.
- PgBouncer with several instances.
- 404s for static chunks during a mixed-release rollout.
- A write in flight during a hard kill.

## 38. Final validation: observability and production-style load

This is the last phase of the scalability program. It added the minimum production observability and validated capacity and failure behaviour with one canonical workload. It fixed only what the validation showed to be unsafe.

**Environment:** the same 8-thread laptop (i5-8365U) runs PostgreSQL 18, every Next.js instance, the workers, k6, the test load balancer, TLS proxy and samplers, on the clone `serene_bench_na6` (300,000 guests, 210 staff accounts, 2 properties). Every throughput number below is therefore **this machine's**: CPU is shared between the database and the application, so adding instances cannot add CPU. Same-host contention is labelled wherever it decides the result. Every result is MEASURED unless marked ESTIMATED, NOT MEASURED or PROPOSED.

### 38.1 Observability audit (before this phase)

| Concern                                | What existed                                                                                                        | Gap closed here                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request latency, p50/p95/p99           | Per response only: opt-in `Server-Timing` (`SERVER_TIMING=1`)                                                       | Aggregated histogram `http_server_request_duration_seconds` by method, route template and status, always on                                                                                    |
| DB time, pool wait                     | Per response, opt-in (`db-acquire`), and only while `SERVER_TIMING=1`                                               | Wait and hold-time histograms per pool, always on; pool size, idle and pending gauges                                                                                                          |
| PostgreSQL CPU / connections           | None in the application (`ops:db-check` budget only)                                                                | Left to the database host's monitoring (OPERATIONS §11.1); `db_client_connection_*` covers the application side                                                                                |
| Worker queue depth                     | `npm run worker -- --stats` (CLI)                                                                                   | `jobs_queue` gauge (cluster queue from PostgreSQL, cached 10 s)                                                                                                                                |
| Worker execution / retries / failures  | JSON event lines, standalone worker only (the inline worker had no handler); `queueWaitMs` declared but never set   | `jobs_total`, `job_duration_seconds`, `job_queue_wait_seconds`, `jobs_reclaimed_total`, `jobs_running`, for inline and standalone workers; event lines now carry `queueWaitMs` and `requestId` |
| SSE connections                        | Count in the readiness body (opt-in)                                                                                | `realtime_streams_active`, opened/closed by reason, listener up/lost, notifications                                                                                                            |
| SSE reconnects                         | None                                                                                                                | Opens per reason; reconnect gaps measured externally (§38.11)                                                                                                                                  |
| Rate-limit failures                    | 429 responses, one log line per minute on store failure                                                             | `rate_limit_rejections_total`, `rate_limit_store_errors_total{policy}`                                                                                                                         |
| Health / readiness / instance identity | Complete (phase 9)                                                                                                  | `serene_instance_info`, `serene_instance_draining`                                                                                                                                             |
| System                                 | None                                                                                                                | CPU, RSS, heap, uptime, event-loop delay (p50, p99, max over 15 s)                                                                                                                             |
| Correlation                            | `x-request-id` (honoured or generated) in responses, error logs and audit rows; jobs keep the starter's `requestId` | `traceparent` trace id accepted; slow-request log line; worker events carry `requestId`                                                                                                        |

**Implementation (no new dependencies):**

- `lib/observability/metrics.ts`: a registry on `globalThis`, so the route bundles and the worker bundle record into one. It renders Prometheus text 0.0.4, which an OpenTelemetry Collector scrapes, with OTel-style names.
- **Endpoint:** `GET /api/metrics`, 404 unless `METRICS_TOKEN` is set and sent as a bearer token. The worker serves the same with `--metrics-port`.
- **Label rules:** the route label is a template (UUIDs → `{id}`, any other non-word segment → `{param}`); each metric keeps at most 1,000 label sets. The test asserts no ids, e-mails, tokens or connection strings appear.
- **Cost (MEASURED):** 3.8 µs per request (one request record plus two pool observations) against 11–17 ms of application CPU per request, i.e. under 0.04 %.

The metric catalog, logs, correlation chain, proposed alerts and PostgreSQL slow-query settings are in OPERATIONS §11.

### 38.2 Production-safety fixes found by the validation

Each fix below has a regression test that fails without it.

1. **Three database pools per process (found by the new pool gauges).** A production process loads `lib/db/prisma.ts` in three bundles: route handlers, rendered pages and instrumentation. Each created its own pool of `DATABASE_POOL_MAX`. Phase 9 had counted two, so the real worst case was 3 × pool + LISTENs per instance and the budget table was wrong.
   - **Fix:** one `pg.Pool` per process on `globalThis` (`pg` is an external package: one copy per process). Each bundle still gets its own PrismaClient, so the per-bundle `instanceof` checks on Prisma errors keep working. Only the creating client may close the pool; shutdown closes it once.
   - **Result:** per instance = pool + 1 realtime LISTEN (+1 worker LISTEN). `ops:db-check` at the defaults: 6 instances + 1 surge (it said 2 before).
   - **Test:** `tests/integration/observability.test.ts` re-imports the module as a second bundle.
2. **A silently dropped LISTEN connection was never noticed.** In a black-holing proxy test the streams kept showing `live` while no notification could arrive; nothing would end it without a TCP reset.
   - **Fix:** the hub checks the connection with `SELECT 1` every 15 s (5 s timeout). An unanswered check counts as lost, so streams get `degraded`, clients poll, and the hub reconnects.
   - **Result:** `degraded` 12.5 s into the hang and `live` 4.7 s after recovery (§38.9).
3. **A silently dropped read replica hung reports and leaked the heavy-report slot.** A replica read on a black-holed connection never returned. It held the only heavy-report slot, so every other heavy report waited 30 s and got 429 for as long as the connection stayed stuck (in the test, indefinitely).
   - **Fix:** a replica read is abandoned after `DATABASE_STATEMENT_TIMEOUT_MS` + 5 s, the replica is marked unhealthy, and the read re-runs on the primary.
   - **Fix:** the heavy slot is now held around the whole read (replica attempt and fallback), not inside the replica attempt.
   - **Fix:** closing the replica pool is bounded at 5 s, so shutdown cannot hang on it.
   - **Result:** every report answered 200; the one request that hit the black hole took 36.3 s (§38.10).
   - **Tests:** two in `tests/integration/read-replica.test.ts`. The slot test was mutation-checked: it fails with the old code.

Not changed:

- **500 vs 503 on database unavailability.** It fails fast and predictably, and readiness takes the instance out. PROPOSED: map connection errors to 503 with `Retry-After`.
- **Hung queries on the primary.** A primary query whose connection the network silently drops has no client-side bound beyond the TCP stack. Readiness fails within 2 s and new checkouts time out after 5 s. PROPOSED: TCP keepalive on pool sockets and `client_connection_check_interval` (OPERATIONS §11.4). NOT MEASURED: needs a real partition, not a proxy.

### 38.3 Canonical workload (`PROFILE=canonical`, `scripts/load/k6/pms-mix.js`)

It is derived from the screens' real API calls since live updates replaced most polling (§31). Percent of user actions:

| Class                      | %   | Class                                                                              | %   |
| -------------------------- | --- | ---------------------------------------------------------------------------------- | --- |
| business date (open pages) | 16  | reservation search                                                                 | 5   |
| me                         | 4   | guest search                                                                       | 4   |
| front-desk summary         | 5   | unified global search (1 request per keystroke)                                    | 4   |
| arrivals                   | 7   | availability                                                                       | 5   |
| in-house                   | 5   | folio list                                                                         | 3   |
| departures                 | 4   | folio read                                                                         | 4   |
| room board                 | 7   | report (manager flash)                                                             | 1   |
| housekeeping tasks         | 5   | **write: guest note**                                                              | 2   |
| housekeeping summary       | 3   | **write: room status** (board read + change with version; 409 is a correct answer) | 4   |
| maintenance summary        | 2   |                                                                                    |     |
| dashboard                  | 4   |                                                                                    |     |
| reservation list           | 6   |                                                                                    |     |

**Total:** 100 % of actions. 6 % are writes; the room-status action is two requests.

**Alongside the user actions:**

- **Job feed:** 2 short jobs/s (claim → fence → finish), standing in for job enqueues. Real enqueues are the night audit, a few per property per day.
- **Event streams:** one per user, up to 100.
- **Heavy reports:** only the manager flash report (1 %); exports are not in the mix, since they are rare.

**Where the server time goes (16 users, k6 `server_total_ms` × count):**

| Class                 | Share of server time       | Average |
| --------------------- | -------------------------- | ------- |
| Unified global search | 24 % (from 4 % of actions) | 790 ms  |
| Guest search          | 8 %                        | —       |
| Reservation search    | 7 %                        | —       |
| Room board            | 7 %                        | —       |
| Arrivals              | 7 %                        | —       |
| Availability          | 6 %                        | —       |

### 38.4 Capacity: 2 instances (inline workers, pool 10), increasing users (MEASURED, same host, 60 s per point)

| Users | req/s | p50      | p95      | p99      | Errors | PG CPU | App CPU | Pool wait avg / p95 | Event loop p99 | Job queue p95 |
| ----- | ----- | -------- | -------- | -------- | ------ | ------ | ------- | ------------------- | -------------- | ------------- |
| 8     | 83.5  | 74 ms    | 205 ms   | 599 ms   | 0 %    | 289 %  | 112 %   | 0.6 / ≤ 5 ms        | 42–47 ms       | 27 ms         |
| 16    | 93.3  | 127 ms   | 385 ms   | 1,087 ms | 0 %    | 345 %  | 124 %   | 3.9 / ≤ 25 ms       | 71–94 ms       | 45 ms         |
| 32    | 99.2  | 258 ms   | 777 ms   | 1,323 ms | 0 %    | 379 %  | 127 %   | 30 / ≤ 100 ms       | 107 ms         | 75 ms         |
| 64    | 101.7 | 496 ms   | 1,591 ms | 2,197 ms | 0 %    | 390 %  | 133 %   | 97 / ≤ 250 ms       | 102–110 ms     | 344 ms        |
| 128   | 102.6 | 959 ms   | 3,473 ms | 4,478 ms | 0 %    | 381 %  | 132 %   | 249 / ≤ 1 s         | 119–154 ms     | 5.9 s         |
| 192   | 102.9 | 1,448 ms | 5,303 ms | 6,592 ms | 0 %    | 394 %  | 133 %   | 394 / ≤ 1 s         | 112–153 ms     | 8.1 s         |
| 256   | 104.4 | 1,856 ms | 6,549 ms | 7,820 ms | 0 %    | 407 %  | 139 %   | 532 / ≤ 2.5 s       | 113–166 ms     | 32 s          |

CPU is a percentage of one thread (800 % = the machine). The other columns:

- **DB connections:** 24 at every load (2 × 10 pooled + 4 LISTEN).
- **RSS of the two instances:** 1.1–1.4 GB.
- **Streams:** 8–100 held, all open.
- **Jobs:** 0 re-executed.

**Saturation point (MEASURED):** about 100 req/s, reached at 32 users. Past it throughput stays flat (≤ 104 req/s at 256 users) while latency and pool wait rise linearly. There were no errors and no timeouts up to 256 users, 8× the saturation load.

- **First bottleneck: PostgreSQL CPU.** It was about 3.8–4.1 threads, roughly 38 ms of PostgreSQL CPU per request in this mix. The instances used about 1.3 threads and the rest of the machine ran k6, the samplers and Windows.
- **Under overload the queueing happens in the pool** (`pending` > 0), which is the predictable place.
- **Jobs share that pool** (§38.2, fix 1), so their queue wait grows with overload. A separate worker process has its own pool (PROPOSED for production beyond 2 instances, §37.10).

### 38.5 Instances: 1, 2, 4, 8 (MEASURED, same host)

| Instances (pool) | 16 users: req/s, p95 | 64 users: req/s, p95, p99  | PG CPU at 64 | App CPU at 64 | DB connections | Event loop p99 at 64 |
| ---------------- | -------------------- | -------------------------- | ------------ | ------------- | -------------- | -------------------- |
| 1 (10)           | 76.9, 408 ms         | 78.1, 1,655, 2,090 ms      | 220 %        | 84 %          | 12             | 63 ms                |
| 2 (10)           | 93.3, 385 ms         | 101.7, 1,591, 2,197 ms     | 390 %        | 133 %         | 24             | 102–110 ms           |
| 2 (5)            | 73.0, 590 ms         | 91.7, 2,070, 2,814 ms      | 370 %        | 113 %         | 14             | 49–52 ms             |
| 4 (10)           | 99.2, 368 ms         | 104.1, 1,672, 2,680 ms     | 409 %        | 158 %         | 48             | 245–296 ms           |
| 4 (5)            | 105.5, 466 ms        | **116.1**, 1,741, 2,557 ms | 466 %        | 170 %         | 28             | 110–186 ms           |
| 8 (5)            | 89.4, 543 ms         | 101.3, 1,590, 3,106 ms     | 428 %        | 167 %         | 56             | 315–414 ms           |

**Scaling efficiency at 64 users, relative to 1 instance:**

| Instances | Throughput | Efficiency |
| --------- | ---------- | ---------- |
| 2         | ×1.30      | 65 %       |
| 4         | ×1.33–1.49 | 33–37 %    |
| 8         | ×1.30      | 16 %       |

**Where scaling stops on this machine:**

- **One instance is limited by the Node process itself:** 0.84 cores of application CPU, with PostgreSQL only half busy.
- **From two instances on, PostgreSQL saturates the shared host.** More processes then add CPU contention: event-loop p99 rose to 0.3–0.4 s at 8 instances, and so did tail latency.
- **8 instances × 64 users:** 3 guest-note writes (0.049 %) failed at the client. No instance recorded an error, so they were transport-level, under 8-process CPU oversubscription. The cause was NOT determined.
- **What this does not show:** these numbers say nothing about scaling on separate hosts.

**Maximum measured throughput:** 116.1 req/s (4 instances, pool 5, 64 users, p95 1.7 s). The best latency at near-maximum throughput was 2 instances at 32 users: 99 req/s, p95 0.78 s.

### 38.6 Backpressure and limits (MEASURED unless marked)

| Pressure                     | Behaviour                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests beyond capacity     | No queue limit or 503 shedding in the application. Requests wait for the pool (`pending`), latency grows, nothing fails             | 256 users (8× saturation): 0 errors, p99 7.8 s. Requests waiting longer than the 5 s connect timeout would answer 500; not reached even with pool 2 at 192 users (p99 6.6 s, 0 errors)                                                                                                      |
| DB pool saturation           | Visible as `db_client_connection_pending_requests` > 0 and wait p95                                                                 | Pool of 2 at 64 users: 41.6 req/s, wait avg 343 ms, 0 errors                                                                                                                                                                                                                                |
| Heavy reports over the limit | 1 per process at a time; others wait up to 30 s, then **429 `REPORTS_BUSY`, `Retry-After: 5`**                                      | 16 parallel year-long guest ledgers: 5 served one by one (8.9–31.9 s), 11 refused at 30.8 s                                                                                                                                                                                                 |
| Rate limits                  | 429 with `Retry-After`, shared across instances. On a store failure, login and password change fail closed (500); other rules allow | §37.6; database outage §38.9                                                                                                                                                                                                                                                                |
| Job queue growth             | Nothing refused; jobs wait, never lost                                                                                              | Overload: queue wait p95 32 s at 256 users, 0 lost or duplicated                                                                                                                                                                                                                            |
| Many event streams           | No per-user or per-instance cap. Each stream costs memory only, no database connection                                              | 1,000 streams on one instance: opened in 3.9 s, RSS +32 MB, request p50/p95 unchanged (16/20 → 17/23 ms). 3,000: opened in 11.6 s, heap +138 MB (≈ 47 KB each), latency unchanged, all closed cleanly (0 left). NOT MEASURED: notification fan-out to thousands of streams under write load |

**PROPOSED, not implemented:** these need evidence from production traffic first.

- **Load shedding:** above roughly 2× the measured saturation, answer 503 with `Retry-After` early instead of queueing (e.g. when pool pending > 4 × pool size). Measured overload stayed error-free but slow.
- **A per-session stream cap** (e.g. 10).

### 38.7 Failure under sustained load (MEASURED)

2 instances behind the load balancer; k6 with 16 users; probes every 50 ms; 10 reconnecting streams; a job feed of 10 jobs/s.

| Event                        | Load balancer                                                                                                       | Failed requests                                                                                                      | Streams                                  | Jobs                                                                                            | Sessions         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| Hard kill of instance 2      | Removed on its first connection error, ≤ 2.2 s after the kill was issued (the PowerShell sender itself takes 1–2 s) | Probes 0 / 981. k6 1 / 10,665: a guest-note POST in flight on the dead instance (the balancer does not retry writes) | Reconnected in 0.27–1.0 s                | 1 job held by the dead instance: retried once, finished once. 1,233 total, 0 duplicates, 0 lost | Valid throughout |
| Restore of instance 2        | Healthy 0.5 s after it answered liveness; restart to back in rotation ≈ 9 s                                         | —                                                                                                                    | —                                        | —                                                                                               | —                |
| Graceful drain of instance 1 | Removed as soon as draining started (readiness 503)                                                                 | 0                                                                                                                    | `reauth:shutdown`, reconnected elsewhere | Not affected                                                                                    | Valid            |
| Restore of instance 1        | Back in rotation ≈ 12 s after the restart was issued                                                                | —                                                                                                                    | —                                        | —                                                                                               | —                |

**k6 over the whole run:** 1 failure in 10,665 requests (0.009 %); p95 542 ms, p99 1.2 s.

### 38.8 A write killed mid-transaction (MEASURED; new in this phase)

A room status change touches `rooms`, `room_status_history` and `audit_logs` in one transaction. The test froze it at its audit insert by holding `LOCK TABLE audit_logs IN SHARE MODE`, after `pg_locks` showed the request's backend already holding row writes on `rooms` and `room_status_history`. Then:

- **Hard kill**, 0.22 s after the freeze:
  - the client got `ECONNRESET`;
  - after the lock was released, the room version, status, history count and audit count were all unchanged;
  - the orphaned backend was gone.

  **Atomic:** PostgreSQL rolled back the transaction because no COMMIT ever arrived. While the lock was held, the orphaned backend kept waiting; `client_connection_check_interval` would end it sooner (OPERATIONS §11.4).

- **Graceful drain:** the drain waited for the frozen request. Once the lock was released it completed with 200, applied exactly once (version +1, one history row, one audit row).

### 38.9 Database failures (MEASURED; one instance whose database connections go through a controllable TCP proxy)

| Phase                               | Liveness | Readiness               | Authenticated reads                                                                       | Login (rate-limit store denies on failure) | Event stream                                        | Jobs                       |
| ----------------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- | -------------------------- |
| Database down (connections refused) | 200      | 503 within 57–251 ms    | 500 `INTERNAL_ERROR` within ≤ 58 ms (fast fail)                                           | 500 (fail closed: no unlimited attempts)   | `degraded` immediately                              | Not claimed; 20 queued     |
| Recovered                           | 200      | 200 after 0.2 s         | 200 after 0.1–0.2 s                                                                       | —                                          | `live` after 1.6 s (reconnect backoff)              | All run, 0 retried, 0 lost |
| Connections hang (black hole)       | 200      | 503 (2 s check timeout) | 500 after ≤ 5 s (connect timeout); a request already in flight hung beyond the 12 s probe | Same                                       | Before the fix: silent. After: `degraded` at 12.5 s | Not claimed                |
| Recovered                           | 200      | 200 after 0.26 s        | 200 after 0.26 s                                                                          | —                                          | `live` 4.7 s after                                  | 40 / 40 run, none twice    |

**Pool exhaustion:** see §38.6 (queueing, no errors).

### 38.10 Read replica unavailable (MEASURED; the replica is the primary behind a second proxy, lag 0, so it counts as healthy)

Closed-date guest ledgers ran back to back.

| Replica phase             | Result                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pass                      | Read from the replica, 200                                                                                                                                            |
| Refused                   | Every request fell back to the primary, 200                                                                                                                           |
| Back                      | The replica was used again after the 10 s re-check                                                                                                                    |
| Black hole, after the fix | The first request was abandoned at the 35 s deadline and answered from the primary (36.3 s total); later ones skipped the unhealthy replica (≈ 1.3 s); 200 throughout |
| Back                      | The replica was used again                                                                                                                                            |

`db_read_route_total` counted replica 70, fallback 36. A user without access to the property still got 403 on the replica path: authorization runs first.

### 38.11 Realtime (MEASURED; 2 instances, 4 streams each, one room change per second, half delivered across instances)

| Condition                   | Deliveries | Lost | Duplicates | p50    | p95    | p99    | Max    |
| --------------------------- | ---------- | ---- | ---------- | ------ | ------ | ------ | ------ |
| Under 32 users of read load | 480 / 480  | 0    | 0          | 213 ms | 269 ms | 340 ms | 359 ms |
| Idle                        | 320 / 320  | 0    | 0          | 208 ms | 214 ms | 215 ms | 216 ms |

About 200 ms of each is the deliberate merge window.

**Loss behaviour:** notifications sent while a LISTEN connection is down are not replayed. Streams get `degraded`, clients poll, and on `live` the screens refetch (§31).

### 38.12 Workers killed during a job, under load (MEASURED)

2 web instances (`JOB_WORKER=off`), 2 worker processes (concurrency 4), k6 with 16 users and a job feed of 2 jobs/s. 8 jobs were held mid-run by a lock on `night_audit_runs`, then the worker holding 4 of them was killed hard.

- **Killed worker's jobs:** the 4 jobs were reclaimed after their lease expired and finished exactly once, on attempt 2, 66.9–68.3 s after the kill. That is the 60 s lease, plus a reclaim poll of ≤ 5 s, plus the retry backoff.
- **Surviving worker's jobs:** its 4 jobs finished on attempt 1.
- **Feed:** 266 jobs, 0 re-executed, queue wait p95 144 ms.
- **Load:** 0 failed requests out of 17,367.

Idempotency of real night-audit jobs (fenced writes, no double posting) is covered by the phase-6 tests.

### 38.13 Endurance: 26 minutes (MEASURED)

**Setup:** 2 instances behind the load balancer, inline workers plus one worker process. Canonical load at 16 users, 200 long-lived streams and a job feed of 2 jobs/s. Every 30 s the run sampled the metrics, the PostgreSQL connection count and the process count.

**Events during the run:**

- a reconnect storm at 8 min: all 200 streams dropped at once;
- a graceful drain of instance 2 at 12 min, restarted at 13 min;
- a hard kill of the worker at 18 min, restarted 9 s later.

**Load:**

- k6 sent 157,041 requests at 100.5 req/s; p50 101 ms, p95 378 ms, p99 1.4 s.
- 3 failed (0.002 %), all writes. The servers recorded no error: only the expected 409 version conflicts (781). The failures were therefore transport-level at the balancer during the instance exit and restart. The cause is ESTIMATED: a keep-alive connection closing under a forwarded request.

**Memory (instance 1, never restarted):**

- RSS averaged 1,011 MB over its first 5 samples and 827 MB over its last 5 (min 793, max 1,085 MB).
- Heap ranged 212–809 MB with GC, trend −8 MB/min.
- No monotonic growth.
- The worker process was sampled only at the end: 133 MB RSS, 301 jobs since its restart. The sampler used the wrong path for its endpoint, so it was not tracked over time.

**Steady state:**

- 10 pooled connections per instance throughout;
- 28–32 PostgreSQL sessions in total;
- process count constant at 3;
- job queue at 0–1;
- 2,842 jobs with 0 lost and 0 re-executed, across the drain and the worker kill.

**Streams:**

- **Ends:** 200 by the storm (client), 99 by the drain (`reauth:shutdown`), and 200 at the 15-minute lifetime (`reauth:expired`). Every one reconnected; 50 attempts were refused with 503 by the draining instance first.
- **Reconnect gaps:** at most 1.9 s.
- **Heartbeats and errors:** 14,214 heartbeats received, 0 stream errors.
- **Leaks:** none. Instance 1's counters closed with 0 left over beyond the open streams (opened 351 = closed 351 after the end).

### 38.14 Security across instances (MEASURED; 3 instances behind an appending load balancer)

**All passed:**

- **Sessions:** login on A, request on B, refresh on C, logout on A; the revoked, pre-refresh and old refresh tokens all got 401 on the other instances. A foreign `Origin` got 403 on every instance (CSRF).
- **Property isolation and RBAC:** the other property's stream and data got 403, someone else's job 404, and an own job at an inaccessible property 404. A role change ended the user's stream on another instance within 15 ms, and a logout ended the session's stream on another instance within 33 ms.
- **Organization isolation:** a second organization, created on the clone, got 403 on the first organization's property, stream and room write, and 404 on its guest and job. Its own guest search returned none of the first organization's guests.
- **Rate limits:** identical at 1 and 3 instances (10 / 20 / 10 before 429).
- **Forwarded headers:** forged `X-Forwarded-For`, `X-Real-IP` and `Forwarded` on every request did not change the identity being limited (20, then 429).
- **Read-replica routing:** authorization runs before the replica (403, §38.10).

### 38.15 Browser smoke test (MEASURED; production build, headless Chrome → TLS proxy → appending load balancer → 2 instances, `TRUSTED_PROXY_HOPS=2`)

**Covered:**

- login and the dashboard;
- front desk, reservations, housekeeping, billing, reports, night audit, guests, availability, and the room board (51 rows);
- property switch SMR → SDX;
- global search: Reservations 5, Guests 5, Folios 5;
- sign-out, after which `/me` returns 401.

**Results:**

- **Load spread:** 216 API responses, 124 and 92 by instance.
- **Errors:** no page exceptions and no console errors.
- **Instance stop:** stopping the instance that held the page's stream got 2 × 503 (draining), then the stream continued on the other instance.
- **Offline:** "Offline mode" was shown and the data kept. Back online, the stream reopened and no requests failed.

### 38.16 Capacity model

**Measured inputs (canonical mix, this machine):**

| Quantity                          | Value           | Basis                                                               |
| --------------------------------- | --------------- | ------------------------------------------------------------------- |
| PostgreSQL CPU per request        | ≈ 35–40 ms      | 289–466 % CPU ÷ 83–116 req/s                                        |
| Application CPU per request       | ≈ 11–17 ms      | One instance: 0.84 cores at 78 req/s; two: 1.33 cores at 102 req/s  |
| Instance-bound ceiling, 1 process | ≈ 78 req/s      | Event loop and application CPU, PostgreSQL half idle                |
| Host-bound ceiling, 2–8 processes | ≈ 100–116 req/s | PostgreSQL ≈ 4 threads + instances ≈ 1.7 threads + k6, on 8 threads |

**ESTIMATED, assuming separate hosts and the same mix.** These are linear CPU arithmetic, an upper bound: real scaling loses to lock contention, cache misses and network latency, none of which was measured.

**Per-component ceilings:**

| Component      | Estimated ceiling                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App CPU        | One Node process ≈ 1 core. At 70 % target utilisation and 11–17 ms per request: ≈ 40–65 req/s per process (78 measured at 84 %). An 8-vCPU host with 6 processes: ≈ 250–400 req/s                                                       |
| DB CPU         | 35–40 ms per request ⇒ ≈ 25–28 req/s per PostgreSQL core. At 70 % utilisation: 8 cores ≈ 160–200 req/s, 32 cores ≈ 640–800, 64 cores ≈ 1,300–1,600. The database saturates first; the application needs ≈ 1 core per 2–3 database cores |
| DB connections | Per instance: pool + 2. At `max_connections` 100: 6 instances (inline, pool 10) or 12 (separate workers, pool 5); 200: 14 / 29; 400: 31 / 62 (§37.10). Beyond that, PgBouncer (transaction mode)                                        |
| Workers        | Measured 74 short jobs/s per worker slot. Real jobs (night audit) are a few per property per day; not a ceiling for this workload                                                                                                       |
| SSE            | Measured 3,000 idle streams per instance (≈ 47 KB of heap each, no database connection). Memory bounds it in the tens of thousands per instance (ESTIMATED, NOT MEASURED); fan-out per notification grows with streams (NOT MEASURED)   |
| Load balancer  | NOT MEASURED (a 90-line test balancer was used). Any production balancer handles several orders of magnitude more than this application's ceiling                                                                                       |

**What a production deployment needs, from the table:**

- **Large hotel group (ESTIMATED):** a 16–32-core primary, 4–8 application instances on 2–4 hosts, 1–2 worker processes and PgBouncer. That gives roughly 300–800 req/s of this mix with headroom.
- **Meaning in users:** at about 0.5–1 dynamic request per active staff member per second, that is 300–1,600 concurrently active staff.

### 38.17 The 100K RPS question

1. **Measured locally:** the canonical mix saturates this laptop at 100–116 req/s with 0 % errors. One instance peaks at 78 req/s. Overload up to 256 users stayed error-free (MEASURED).
2. **Measured with several instances:** 1/2/4/8 instances on the same host gave 78 / 102 / 104–116 / 101 req/s. Scaling stops at 2 because PostgreSQL and the instances share 8 threads (MEASURED).
3. **Local saturation point:** about 100 req/s at 32 users, 2 instances (MEASURED).
4. **First bottleneck:** PostgreSQL CPU, about 38 ms per request. The unified global search alone is 24 % of server time, then guest and reservation search, the room board and arrivals (MEASURED). With one instance, the Node process saturates first (MEASURED).
5. **Architecture needed even to test 100K req/s of this mix (ESTIMATED):**
   - **Application:** 100,000 × 11–17 ms ≈ 1,100–1,700 cores of application CPU, i.e. about 1,500–2,500 Node processes at 70 %.
   - **Database:** 100,000 × 35–40 ms ≈ 3,500–4,000 database cores. No single PostgreSQL primary has that.
   - **What 100K would therefore require (PROPOSED):**
     - one or more of: caching the read-mostly screens (business date, dashboard, room board); read replicas, which today could take only about 4 % of the mix (§35); and partitioning tenants across several PostgreSQL clusters by organization (the natural isolation key);
     - an order-of-magnitude cut in database CPU per request for search;
     - a managed load-balancer tier.
6. **Traffic mix the target refers to:** undefined. **100K req/s of dynamic staff API traffic means roughly 100,000–200,000 concurrently active staff.** That is far beyond the hotel groups this PMS serves. A 100K figure that includes CDN-served static assets, health checks or a public booking engine (which this application does not have) is a different workload, and must be stated before it is tested.
7. **Database capacity required:** see 5. In short, about 4,000 cores' worth at today's cost per request, or a much smaller cluster after caching and query work. Either way, multiple primaries (sharding) for writes beyond a single server (ESTIMATED).
8. **App instances required:** about 1,500–2,500 single-threaded processes, i.e. about 200–300 hosts with 8 vCPU each (ESTIMATED).
9. **Load-generator infrastructure:** k6 here reached a few hundred req/s on a shared laptop. 100K req/s of authenticated dynamic traffic needs a distributed generator fleet, on the order of 20–50 dedicated 8-vCPU hosts or a cloud load-testing service. It also needs pre-created sessions for tens of thousands of users, and must be in the same region as the system under test (ESTIMATED).

**Status: 100K RPS is NOT MEASURED and NOT CLAIMED.** It cannot be tested on this machine. Nothing measured here suggests the current single-primary architecture could reach it; the arithmetic in point 5 suggests it could not without the changes listed there.

### 38.18 Production readiness checklist

| Area           | Item                                                                                                                                   | State                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Application    | Stateless instances, no affinity                                                                                                       | Done (§37.1, re-verified §38.14–15)                                              |
|                | Health: liveness without database, readiness with database and draining                                                                | Done                                                                             |
|                | Graceful shutdown (`npm start`), bounded                                                                                               | Done; measured under load (§38.7–8)                                              |
|                | Environment validation (secrets, `TRUSTED_PROXY_HOPS`, `METRICS_TOKEN`)                                                                | Done                                                                             |
|                | Timeouts: statement 30 s, transaction 15 s, connect 5 s, replica read 35 s, stream heartbeat 25 s / lifetime 15 min, LISTEN check 15 s | Done                                                                             |
| Database       | Connection budget: one pool per process, `ops:db-check`                                                                                | Done (corrected this phase)                                                      |
|                | Migrations as a single separate step; expand/contract for rolling releases                                                             | Done (§37.11)                                                                    |
|                | Backups and restore drill                                                                                                              | Documented (OPERATIONS §2); not exercised in this phase                          |
|                | Replication readiness, deadline and fallback                                                                                           | Done (§38.10); not enabled                                                       |
|                | Slow-query settings                                                                                                                    | PROPOSED settings in OPERATIONS §11.4; enable `pg_stat_statements` in production |
| Infrastructure | Load balancer: readiness checks, no affinity, GET-only retries                                                                         | Contract in OPERATIONS §10                                                       |
|                | TLS at the proxy; HSTS from the application                                                                                            | Done                                                                             |
|                | Proxy buffering off for `/events`; idle timeout > 25 s; abort upstream on client disconnect                                            | Contract                                                                         |
|                | Forwarded headers: append, hops counted                                                                                                | Done; spoofing tested                                                            |
|                | Connection draining ≥ `SHUTDOWN_DRAIN_MS`; upstream keep-alive idle < Node's                                                           | Contract (§37.13)                                                                |
| Workers        | Inline (≤ 2 instances) or separate processes (beyond)                                                                                  | Documented; both measured                                                        |
|                | Concurrency (`JOB_WORKER_CONCURRENCY`), lease 60 s, retry with backoff, fencing                                                        | Done; recovery 67–68 s measured                                                  |
| Observability  | Metrics (`/api/metrics`, worker `--metrics-port`)                                                                                      | Done                                                                             |
|                | Logs: errors (redacted), slow requests, job events, shutdown                                                                           | Done                                                                             |
|                | Traces: request id and `traceparent` correlation; no distributed tracing SDK                                                           | Partial: PROPOSED, an OpenTelemetry SDK if a tracing backend exists              |
|                | Alerts                                                                                                                                 | PROPOSED rules in OPERATIONS §11.3                                               |
| Security       | Secrets validated; never logged or in metrics                                                                                          | Done                                                                             |
|                | Authentication, RBAC, property and organization isolation across instances                                                             | Done (§38.14)                                                                    |
|                | Rate limiting shared across instances, fail-closed for login                                                                           | Done                                                                             |

### 38.19 Final conclusion

**Measured capacity:**

- On one shared 8-thread machine, the canonical PMS workload runs at about 100 req/s with 2 instances (≈ 78 req/s per instance alone), peaking at 116 req/s.
- Errors were 0 % at every concurrency from 8 to 256 users. p95 was 0.4 s at 16 users and 0.78 s at the 32-user saturation point.

**Saturation point:** 32 users, about 100 req/s. PostgreSQL CPU, at about 38 ms per request, is the first bottleneck. Under overload, queueing happens in the pool; there are no errors, no timeouts and no leaks.

**Production architecture:**

- stateless Next.js instances behind a health-checking load balancer, with no affinity;
- 1–2 worker processes;
- one PostgreSQL primary per tenant group, with PgBouncer beyond about 12 instances;
- an optional replica for closed-date reports;
- scrape `/api/metrics` with the alerts in OPERATIONS §11.

**Known limitations:**

- Search-heavy screens (the unified global search above all) dominate database CPU.
- Hung primary connections after a silent network partition are bounded only by readiness and the TCP stack.
- Overload is not shed, only queued.
- No measurement exists on separate hosts, behind a real load balancer, or with PgBouncer under load.

**100K RPS status:** NOT MEASURED, NOT CLAIMED, and not achievable with a single-primary architecture at today's cost per request (ESTIMATED, §38.17).

**Next operational requirements:**

1. Measure on production-like separate hosts (the application tier and PostgreSQL apart).
2. Enable `pg_stat_statements` and the alerts.
3. Define the 100K target's traffic mix.
4. If a much larger scale is truly needed: reduce search cost, cache read-mostly screens, and plan organization-level partitioning.

## 39. Production-readiness regression

After the production-readiness fixes (docs/PRODUCTION_READINESS.md), the canonical workload of §38 was re-run on the same machine (MEASURED, 2 instances, inline workers, pool 10):

| Measurement                     | §38 baseline                       | After the fixes                           |
| ------------------------------- | ---------------------------------- | ----------------------------------------- |
| 16 users                        | 93.3 req/s, p95 385 ms             | 111.4 and 119.2 req/s, p95 302 and 283 ms |
| 64 users                        | 101.7 req/s, p95 1,591 ms          | 111.3 req/s, p95 1,454 ms                 |
| Errors                          | 0 %                                | 0 %                                       |
| PostgreSQL CPU                  | 345–390 %                          | 367–390 %                                 |
| Realtime (idle, cross-instance) | p50 / p95 / p99 208 / 214 / 215 ms | 208 / 216 / 218 ms; 0 lost, 0 duplicates  |
| Workers (2 instances)           | 114–135 jobs/s                     | 199 jobs/s                                |
| Crash recovery (200 jobs)       | 17.5 s                             | 14.3 s                                    |

No regression. The host varies about ±25 % between identical runs, so the higher numbers are not claimed as improvements.
