# SERENE MANAGEMENT — Production readiness audit

The pre-production gate audit, run after the scalability program, from checkpoint `a70992d` (tag `scalability-complete`).

**Labels:**

- **FIXED** (with a regression test);
- **VERIFIED** (measured or executed);
- **NOT VERIFIED**;
- **PROPOSED**.

**Severity** is decided by concrete impact:

| Level | Meaning                    |
| ----- | -------------------------- |
| P0    | Release blocker            |
| P1    | Must fix before production |
| P2    | Should fix soon            |
| P3    | Post-launch improvement    |

Only P0 and P1 block the release.

## 1. Scope

| Area                   | How it was audited                                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory              | 159 API route files (183 handlers), 36 pages, 27 modules, 127 models, 27 migrations, 73 test files                                                                                                                                                                                                                   |
| Code review            | Six independent read-only reviews, each finding re-checked in the code before it was classified: (1) authentication, sessions, RBAC; (2) financial correctness; (3) night audit and background jobs; (4) input validation, API security, errors; (5) offline, realtime, privacy; (6) schema, migrations, concurrency |
| Database               | Migration status; drift between the live database, the migrations and the Prisma schema (`prisma migrate diff`); an offline schema-vs-migrations comparison (tables, columns, 264 foreign keys, enums, indexes); `ops:db-check`                                                                                      |
| Dependencies           | `npm audit`, `npm outdated`, the dependency paths of every advisory                                                                                                                                                                                                                                                  |
| Build                  | Clean production build from scratch (`.next` and `dist` removed): source maps, static assets, debug pages                                                                                                                                                                                                            |
| Backup / recovery      | The documented drill (OPERATIONS §2.3) end to end against a disposable database                                                                                                                                                                                                                                      |
| UAT                    | 20-step hotel lifecycle on a production build behind TLS, a load balancer and 2 instances, on a restored copy of the development data                                                                                                                                                                                |
| Security regression    | The full test suite plus 23 cross-instance checks on the production build                                                                                                                                                                                                                                            |
| Performance regression | The canonical workload of SCALABILITY §38 against the final baseline                                                                                                                                                                                                                                                 |

## 2. Release blockers found and fixed

### P0-1 — FIXED: configuration changes re-billed nights already posted

**Defect:** `postNightsInTx` (`modules/billing/billing.service.ts`) planned every night up to the posting date from today's configuration. It posted any line whose posting key had no live posting, even for nights already marked posted.

- **Package added later:** if a package was added to a rate plan (`PUT /rate-plans/{id}/packages`), or a component to a package, after some nights had been charged, the next night audit or room-charge posting charged that package for every past night of every in-house stay on the plan.
- **Reversed package line:** a package line the cashier had reversed came back at the next posting (a new generation of the same key).

**Impact:** silent over-billing of in-house guests after a routine configuration change.

**Fix:** a night flagged as posted is final, and its lines are never re-planned. Reversing the room line clears the flag, which keeps the documented re-post of a reversed night working.

**Tests:** in `tests/integration/billing.test.ts`:

- "never posts lines for a night already posted, whatever was configured later";
- "does not bring back a reversed package line at the next posting".

Both fail without the fix (mutation-checked). All 83 billing, night-audit, rates/groups and reservation tests pass.

### P1-1 — FIXED: no request-body size limit (anonymous memory exhaustion)

**Defect:** `parse()` (`lib/http/route.ts`) read every JSON body with `request.json()`: the whole body in memory, before validation. An anonymous `POST /api/v1/auth/login` with a body of hundreds of megabytes was buffered and parsed. The per-IP limit still allows 20 such requests a minute per address.

**Impact:** one client could exhaust an instance's memory.

**Fix:**

- **Limit:** JSON bodies are capped at 1 MiB. The check runs on `Content-Length` and again while the body streams in (chunked bodies have no length).
- **Response:** `413 PAYLOAD_TOO_LARGE` (a new, additive error code, API_CONVENTIONS §5).
- **Headroom:** the largest legitimate body, an avatar, is about 350 KB.
- **Deployment:** DEPLOYMENT §7 now also asks for a proxy limit.

**Test:** `tests/integration/request-limits.test.ts` covers a declared size, an endless chunked stream, and normal and malformed bodies. On the production build an oversized login body got 413.

### P1-2 — FIXED: the offline view showed the last user's guest lists without a session

**Defect:** `/offline` is a public page. It showed the IndexedDB snapshot of the last user who signed in on the browser after checking only "same user as recorded" and age (24 h). It never asked the server, even when online.

**Impact:**

- On a shared front-desk PC, after that user's session ended (closed browser, expiry, revocation, disabled account), anyone could open `/offline` and read arrivals, in-house guests and departures: names, rooms, dates and VIP levels.
- Property access removed from that user stayed readable the same way.
- This contradicted OFFLINE_ARCHITECTURE §J.

**Fix:** `lib/offline/verifySession.ts` and `OfflineView`. While the server is reachable nothing is shown until `/me` (after one token refresh if needed) confirms the session:

- no session wipes everything;
- a live session is reconciled with its current access first;
- only an unreachable server (the real offline case) shows the copy unconfirmed.

**Tests:** `tests/unit/offline-session.test.ts`.

**VERIFIED in the browser on the production build:**

- an offline navigation served the snapshot;
- reconnecting worked;
- after the session was revoked server-side without signing out, opening `/offline` online left 0 snapshots and 0 session data.

### P1-3 — FIXED: stay details exposed guest contact data without `guests:read`

**Defect:** `GET /stays/{id}` (`frontdesk:read`) always returned the guest's e-mail and phone.

**Impact:** a role with `frontdesk:read` but not `guests:read` (e.g. the Housekeeping Manager template) read guest contact data. That bypasses the guest-profile permission boundary (D56, RBAC.md), the same kind of bypass previously fixed for audit trails (L9).

**Fix:** contact data only with `guests:read` (as the audit trail decides it). Other callers get `null`, and the UI shows "—".

**Test:** in `tests/integration/front-desk.test.ts`, "shows guest contact data on a stay only to callers with guests:read".

## 3. Findings that do not block the release

### P2 — should fix soon (none endangers data integrity or isolation)

| #     | Finding                                                                                                                                                                      | Concrete impact                                                                                             | Why not P1                                                                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1  | Refresh-token reuse is detected only for the previous token. A token ≥ 2 rotations old answers 401 without revoking the session (`identity.service.ts` `rotateRefreshToken`) | A stolen refresh token used first keeps its session until absolute expiry; the real user is just signed out | Needs theft of an HttpOnly, Secure, SameSite=Strict, path-scoped cookie; this is detection depth, not an open path. PROPOSED: track the token family and revoke on any stale reuse |
| P2-2  | `grantRole` / `revokeRole` authorize from the request-start profile, not the one re-read under the organization lock                                                         | An administrator demoted by a concurrent command could still finish one grant or revoke                     | Two administrators racing within milliseconds; the action is audited                                                                                                               |
| P2-3  | Reservation and walk-in creation take no Idempotency-Key                                                                                                                     | A client retry after a lost response books twice                                                            | Not in the API contract (keys are required on financial, night-audit and block routes); the duplicate is visible and cancellable; there is no OTA integration yet                  |
| P2-4  | Malformed input reaching PostgreSQL answers 500, not 400: a tampered cursor (`22P02`), year-0000 dates (`22008`), charge amounts × quantity above `numeric(19,4)` (`22003`)  | 500s and error-log noise; anyone can trigger the 5xx alert                                                  | No data is written, nothing leaks (generic message), and only the caller is affected. PROPOSED: validate decoded cursor ids and dates, and bound years and amount products         |
| P2-5  | The night-audit balance check runs under the default 30 s statement timeout and its candidates grow with history (SCALABILITY §34.7)                                         | At about 10× the measured history the audit cannot complete (FAILED, date reopened, no corruption)          | Measured 2–3 s today. PROPOSED: give Phase B checks the Phase C timeout, or bound the candidates                                                                                   |
| P2-6  | The night-audit give-up (reopen the date) runs once, after the job is FAILED; if the database is still down or the worker dies then, the date stays IN_AUDIT                 | Postings answer 423 until someone with `nightaudit:run` uses Recover                                        | A manual Recover exists and is alerted (`jobs_total{outcome="failed"}`). OPERATIONS §7 corrected (it claimed a guaranteed reopen)                                                  |
| P2-7  | A Phase C longer than the job lease that then fails can lose its lease before recording the failure                                                                          | The real error is lost; the audit retries up to 3 times before failing                                      | Needs a > 60 s commit that fails; the outcome is still consistent                                                                                                                  |
| P2-8  | The block-pickup queries in `availability.repository.ts` join without `property_id`, while inventory rows are locked                                                         | Booking lock hold time grows with total reservations (no skip scan before PostgreSQL 18)                    | Correct results; a performance risk only, not measured at today's volume                                                                                                           |
| P2-9  | Company (account profile) contact data shows in audit history to `audit:read` holders                                                                                        | Business contact data visible to auditors                                                                   | Company records, not guest profiles; auditors are trusted readers                                                                                                                  |
| P2-10 | Route labels keep any lower-case path segment, so unauthenticated requests can fill the 1,000-series cap per metric                                                          | Later routes fold into `overflow`                                                                           | No personal data in labels (ids and e-mails become placeholders); memory is bounded                                                                                                |
| P2-11 | `requireOpenBusinessDate` waits (`FOR SHARE`, no NOWAIT) while Phase C holds the date                                                                                        | Commands at that property hold pool connections for up to 15 s during the commit                            | Phase C takes seconds today                                                                                                                                                        |

### P3 — post-launch improvements

**Data model and integrity:**

- Postings to a CLOSED folio are refused by the application only; the database trigger does not check folio status. Latent: CLOSED is not reachable yet.
- An extension would oversell a different rate room type if upgrades are added. Latent: the two room types are always equal today.
- Some reference columns lack a foreign-key backstop: on `folio_items`, `cash_movements`, `loyalty_transactions`, `turnaways` and `blocks.sales_owner_id`.

**Realtime and permissions:**

- A super-admin demotion and a hard-deleted session do not notify open streams. They end within 15 min, and streams carry topic names only.
- Check-out shows folio balances to custom roles that hold `frontdesk:checkout` without `billing:read`. Built-in roles all hold `billing:read`.

**Dependencies:**

- `npm audit`: 4 high advisories, all in the `prisma` CLI's transitive `mysql2` and `deepmerge-ts`. They are not reachable: no MySQL connection is ever made, and the merge only reads our own config. No stable Prisma 7 release fixes them; npm's suggestion is a downgrade to 6.
- Patch releases (`next` 16.3.8, `pg` 8.23.1, `react` 19.3) have no known security reason to upgrade.

**Functional gaps (documented):**

- No same-day check-out or reverse check-in (422 `SAME_DAY_CHECK_OUT`).
- The integration outbox has no consumer, and there is no payment-provider integration: payments are recorded, not processed.
- Offline mode is read-only.

**Cosmetic:** Prisma reports the partial index `background_jobs_active_dedupe_key` as different from the database. It is the same predicate, stored as `= ANY (ARRAY[…])`.

**Jobs:**

- Night-audit Phase C does not retry transient deadlocks (an operator restarts the audit).
- Job payloads carry no version field. No incompatible payload change exists.

## 4. Verified correct (summary)

**Authentication:**

- Access tokens pin algorithm, issuer and audience, carry no permissions, and every request re-reads session, user, organization and property state.
- Logout, password change, admin reset and disable all revoke sessions.
- Login has per-account and per-IP limits plus lockout, and one argon2 run on every path.
- Escalation guards apply, and admin actions are scoped to the organization.

**Authorization:**

- All 159 route files go through `define*Route`.
- Property routes take the property from the path and check access before reading the body.
- Records are loaded scoped to the property or organization.
- No mass assignment: every schema is strict and every array bounded.

**Input:**

- All raw SQL is parameterised.
- Sort fields are allow-listed and pagination is capped.
- No open redirect (`safeNextPath`) and no path traversal (avatars are stored in the database and sniffed).
- CSV formula injection is escaped.

**Errors:** clients see `AppError` messages only; logs record database errors by code and redact secrets.

**Headers:** nonce CSP, HSTS, nosniff, DENY framing; `__Host-`/`__Secure-` cookies.

**Money:**

- bigint arithmetic, one rounding rule, net + tax = gross exactly;
- trigger-maintained totals with a CHECK;
- refunds bounded by CHECK and a trigger;
- void and reversal uniqueness;
- mandatory idempotency keys on every financial route;
- the posting-date guard;
- append-only ledgers;
- one ledger behind the folio view, check-out, night audit and reports.

**Concurrency:**

- exclusion constraint against double room assignment;
- one in-house stay per room;
- locks in a consistent order with version checks after the lock;
- inventory counters re-counted under locks.

**Night audit and jobs:**

- no double business-date advance;
- no double posting (one Phase C transaction, posting keys);
- fenced writes;
- `SKIP LOCKED` claims, leases, backoff;
- retention of finished jobs (30 days).

**Realtime:** property and topic filtering, topic-only payloads, access-change triggers.

**Schema:** no drift. Money is `NUMERIC(19,4)`, every timestamp `timestamptz`, every business date `DATE`.

## 5. Verification status

| Check                                            | Result                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify` (typecheck, lint, tests, build) | VERIFIED: see §8                                                                                                                                                                                                                                     |
| Clean production build from scratch              | VERIFIED: 139 s, 44 static pages, no browser source maps (`.next/static` has 0 `.map`), the design-system page is `notFound()` in production                                                                                                         |
| Migration status                                 | VERIFIED: 27 applied, up to date; no migration added or modified                                                                                                                                                                                     |
| Drift: live database vs schema                   | VERIFIED: only the cosmetic partial-index text (P3)                                                                                                                                                                                                  |
| Drift: schema vs migrations (offline replay)     | VERIFIED: no drift (the one table difference is the intentional `UNLOGGED rate_limit_windows`)                                                                                                                                                       |
| `ops:db-check`                                   | VERIFIED: OK. The development warnings about the role owning the tables are expected (D53)                                                                                                                                                           |
| Backup / restore drill                           | VERIFIED: create 2 s, verify (checksum, 128 tables), restore into `serene_restore_drill` 6 s. The restored copy is migrated and passes `db-check`; row counts and the newest audit time are identical to the source; the application ran on it (UAT) |
| UAT                                              | VERIFIED: 20 / 20 steps (§6)                                                                                                                                                                                                                         |
| Security regression                              | VERIFIED: full test suite plus 23 / 23 cross-instance checks (§7)                                                                                                                                                                                    |
| Performance regression                           | VERIFIED: no regression (§7)                                                                                                                                                                                                                         |
| Debug endpoints                                  | VERIFIED: `/api/metrics` 404 without its token; design system 404 in production                                                                                                                                                                      |

## 6. UAT (production build, TLS → load balancer → 2 instances, disposable restored database)

| #   | Step                                                                                                        | Result                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Login                                                                                                       | PASS                                                                          |
| 2   | Property selection                                                                                          | PASS                                                                          |
| 3   | Guest creation                                                                                              | PASS; duplicate-profile detection also confirmed (409)                        |
| 4   | Reservation creation                                                                                        | PASS                                                                          |
| 5   | Modification (adults, departure)                                                                            | PASS                                                                          |
| 6   | Availability                                                                                                | PASS                                                                          |
| 7   | Arrival list                                                                                                | PASS                                                                          |
| 8   | Check-in                                                                                                    | PASS                                                                          |
| 9   | Room move                                                                                                   | PASS                                                                          |
| 10  | Housekeeping update of the vacated room                                                                     | PASS                                                                          |
| 11  | Charge posting                                                                                              | PASS                                                                          |
| 12  | Payment, with an idempotent retry                                                                           | PASS: one payment recorded                                                    |
| 13  | Check-out of the guest due out (balance settled first)                                                      | PASS                                                                          |
| 14  | Night audit: readiness → start (202) → worker → completed in about 1 s; business date 09-25 → 09-26         | PASS: the UAT guest's night charged once, 0 duplicate posting keys            |
| 14b | Next-day early check-out of the UAT guest, folio at zero                                                    | PASS                                                                          |
| 15  | Reports for the closed date (5 reports) and CSV export                                                      | PASS                                                                          |
| 16  | Global search                                                                                               | PASS                                                                          |
| 17  | Multi-property switching (organization administrator) and isolation (the other property's manager gets 403) | PASS                                                                          |
| 18  | Offline and reconnect, in a browser                                                                         | PASS: P1-2 verified there                                                     |
| 19  | Sign-out                                                                                                    | PASS: `/me` 401 afterwards                                                    |
| 20  | Permission revocation                                                                                       | PASS: 403 on the next request, and the user's live stream ended with `reauth` |

**Not available (functional gap, P3):** same-day check-out of a guest who arrived today.

**Audit trail:** recorded for every step (`guest.create`, `reservation.create` / `update`, `folio.open`, `stay.check_in`, `stay.room_move`, `housekeeping.room_mark_clean`, `folio.post_charge`, `folio.payment`).

## 7. Regression

### Security (production build, 2 instances)

All checks passed:

- **Property isolation:** another property's folios, ledger, event stream, reports and room writes gave 403.
- **Financial access:** a housekeeping manager got 403 on the folio ledger and payments; maintenance staff got 403 on financial reports and users admin.
- **Guest profiles:** 403 without `guests:read`.
- **Forged ids:** unknown ids gave 404; malformed ids 400.
- **Job isolation:** someone else's job gave 404.
- **Sessions:** a session was valid on both instances, then revoked on both after logout (401).
- **CSRF:** a foreign `Origin` or a missing `Origin` on a write gave 403.
- **Rate limits:** the per-account login limit allowed 10, then 429. The per-IP limit with forged `X-Forwarded-For` / `X-Real-IP` / `Forwarded` through the TLS → load balancer chain allowed 20, then 429.
- **Body size:** an oversized body gave 413.
- **Metrics:** the endpoint without its token gave 404.
- **Offline isolation:** see P1-2.
- **SSE isolation:** see UAT step 20 and the property checks above.

Sending forged headers straight to the load balancer, skipping a hop that the configuration (`TRUSTED_PROXY_HOPS=2`) counts, does let a client choose its address. That is the documented misconfiguration of DEPLOYMENT §7: the hop count must match the real proxy chain, and instances must be reachable only through it.

### Performance (canonical workload of SCALABILITY §38, 2 instances, same host)

| Measurement           | Baseline                           | Now                                      |
| --------------------- | ---------------------------------- | ---------------------------------------- |
| 16 users              | 93.3 req/s, p95 385 ms             | 111.4 / 119.2 req/s, p95 302 / 283 ms    |
| 64 users              | 101.7 req/s, p95 1,591 ms          | 111.3 req/s, p95 1,454 ms                |
| Errors                | 0 %                                | 0 %                                      |
| PostgreSQL CPU        | 345–390 %                          | 367–390 %                                |
| Pool wait             | —                                  | Same                                     |
| Realtime (idle)       | p50 / p95 / p99 208 / 214 / 215 ms | 208 / 216 / 218 ms; 0 lost, 0 duplicates |
| Workers (2 instances) | 114–135 jobs/s                     | 199 jobs/s                               |
| Crash recovery        | 17.5 s                             | 14.3 s                                   |

No regression. The host is noisy (±25 % between identical runs), so the gains are not claimed as improvements.

## 8. Final verification status

The final checks are recorded in the final report:

- `npm run verify`
- migration status
- `ops:db-check`
- cleanup: no benchmark credentials, temporary databases, test processes or TLS keys left

## 9. Remaining risks

- **P2 items (§3):** most relevant operationally are night-audit give-up durability (P2-6) and balance-check growth (P2-5). Monitor with the alerts in OPERATIONS §11.3.
- **Never measured on production-like infrastructure:** separate hosts, a real nginx/HAProxy/cloud balancer, PgBouncer, PostgreSQL physical replication and point-in-time recovery (NOT VERIFIED).
- **Capacity:** about 100 req/s for the canonical mix on one 8-thread host; the database CPU per request is the limit (SCALABILITY §38). 100K RPS is not claimed.
- **Offline:** while the server is unreachable, the last snapshot (≤ 24 h) is readable on that device. Shared PCs must sign out at the end of a shift.
- **Payments:** no payment-service-provider integration. Card payments are taken on an external terminal and recorded.

## 10. Operational prerequisites before going live (PROPOSED and DOCUMENTED; not part of the code gate)

| Area                    | Prerequisite                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets and environment | Production `.env` with generated secrets (the validation refuses placeholders); `APP_URL` https; `TRUSTED_PROXY_HOPS` equal to the real proxy chain; `METRICS_TOKEN` (DEPLOYMENT §2)                                                                                |
| Database roles          | A runtime role that does not own the tables (`scripts/db/runtime-role.sql`); `ops:db-check -- --strict` clean (OPERATIONS §4)                                                                                                                                       |
| Migrations              | `npm run db:deploy` as its own release step; a backup before every release with migrations (DEPLOYMENT §4, §9)                                                                                                                                                      |
| Backups                 | Nightly `ops:backup create`, off-host encrypted copies, retention 14/8/12, a quarterly restore drill; point-in-time recovery if a 24 h RPO is too long (OPERATIONS §2)                                                                                              |
| Proxy and load balancer | TLS; health checks on `/api/health/ready`; no buffering for `/events`; idle timeout > 25 s; abort upstream on client disconnect; `client_max_body_size 1m`; an upstream keep-alive idle timeout shorter than Node's; `X-Request-Id` (OPERATIONS §10, DEPLOYMENT §7) |
| Process manager         | `npm start`; stop timeout ≥ `SHUTDOWN_TIMEOUT_MS` + 5 s; `npm run worker` processes beyond 2 instances; a connection budget within `max_connections` (OPERATIONS §6)                                                                                                |
| Monitoring              | Scrape `/api/metrics`; the alerts of OPERATIONS §11.3; `pg_stat_statements` and the slow-query settings of OPERATIONS §11.4                                                                                                                                         |
| People                  | Shift procedure: sign out on shared PCs. A named operator holds `nightaudit:run` for Recover (P2-6)                                                                                                                                                                 |

## 11. Release decision

All P0 and P1 findings are fixed, covered by regression tests and verified on a production build. The remaining findings are P2/P3 with documented impact. The decision is in the final report of this audit, and stands only if `npm run verify` passes.
