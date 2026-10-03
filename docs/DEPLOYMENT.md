# Deployment

How to install, configure, start and verify SERENE MANAGEMENT on servers. **Docker is not used** and PostgreSQL runs natively. Two layouts are supported:

- **Single server:** one Node.js process (web and background jobs, `JOB_WORKER=inline`) behind a TLS reverse proxy, with PostgreSQL on the same or another host.
- **Production topology (§11):** a TLS reverse proxy / load balancer in front of two or more stateless web instances (`JOB_WORKER=off`), separate worker processes (`npm run worker`), one shared PostgreSQL. Sessions, rate limits, jobs and live-update fan-out live in PostgreSQL, so no sticky sessions, Redis or broker are needed. Live updates use server-sent events, which the proxy must not buffer.

PgBouncer and a read replica are optional and enabled only when provisioned (OPERATIONS.md §6). The full variable checklist is §10, the reference proxy and service configuration §11, and the release rehearsal of v1.0.0-rc1 §12.

Related: [OPERATIONS.md](OPERATIONS.md) (backups, restore drill, migration policy, database roles, retention, pool settings, scheduling, CI), [ARCHITECTURE.md](ARCHITECTURE.md) (D44 client IP, D48 deployment, D50–D53 operations), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [RBAC.md](RBAC.md).

## 1. Requirements

- Node.js ≥ 22.12.
- PostgreSQL 17+ as a native service on the host or a reachable server, with `psql`.
- Two database roles, neither a superuser (OPERATIONS.md §4). The **schema owner** owns the database and runs migrations and backups. The **runtime role** is created by `scripts/db/runtime-role.sql` and is what the application connects as. On Windows, `npm run db:setup` creates the owner role and the databases from `DATABASE_URL` (a single-role setup, fine for development). On Linux, create them with `createuser` / `createdb`.
- The PostgreSQL client tools `psql`, `pg_dump` and `pg_restore`, in the server's major version or newer, for the role script and the backups.
- TLS termination on the reverse proxy. The application only accepts an `https://` `APP_URL` in production.

## 2. Environment variables

Set these in the process environment (systemd unit, Windows service, process manager) or in a `.env` file next to `package.json`. Real environment variables win over `.env`. Never commit `.env`. `.env.example` lists every variable.

| Variable                                  | Production  | Rule                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                | required    | `production`. `next start` sets it itself; the ops commands read it from the environment.                                                                                                                            |
| `DATABASE_URL`                            | required    | The **runtime role's** `postgresql://user:password@host:5432/db`. The password must be real (no `change-me`, not empty).                                                                                             |
| `AUTH_ACCESS_TOKEN_SECRET`                | required    | ≥ 32 characters, random (`openssl rand -base64 48`). No placeholder text.                                                                                                                                            |
| `AUTH_REFRESH_TOKEN_SECRET`               | required    | Same rules, and **different** from the access secret. It also peppers refresh and password-reset token hashes: changing it signs everyone out and invalidates outstanding reset links.                               |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`           | optional    | 60–3600, default 900.                                                                                                                                                                                                |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`          | optional    | 3600–7776000 (90 days), default 1209600 (14 days). Must be longer than the access TTL.                                                                                                                               |
| `FIELD_ENCRYPTION_KEY`                    | optional    | When set, 32 random bytes in base64 (`openssl rand -base64 32`). Reserved for encrypting sensitive guest fields.                                                                                                     |
| `APP_URL`                                 | required    | The public URL users open, `https://…`. Must not be `localhost`, `127.0.0.1`, `0.0.0.0` or `::1`. Used for the same-origin check on writes and for links in operator output.                                         |
| `MIGRATION_DATABASE_URL`                  | recommended | The schema owner's connection, used only by `db:deploy`, `migrate status` and `ops:backup`. When unset, `DATABASE_URL` is used for everything; `ops:db-check` then warns, because the application runs as the owner. |
| `READ_DATABASE_URL`                       | optional    | A streaming standby for closed-date reports only; unset (the default) keeps every query on the primary. Prerequisites: OPERATIONS.md §6, SCALABILITY.md §35.                                                         |
| `DATABASE_POOL_MAX`                       | optional    | Connections per process, 1–50, default 10. Do not raise it to fix slowness (OPERATIONS.md §6).                                                                                                                       |
| `DATABASE_CONNECT_TIMEOUT_MS`             | optional    | 500–60000, default 5000.                                                                                                                                                                                             |
| `DATABASE_STATEMENT_TIMEOUT_MS`           | optional    | 1000–600000, default 30000. The night audit commit raises its own limit.                                                                                                                                             |
| `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | optional    | 1000–3600000, default 60000.                                                                                                                                                                                         |
| `TRUSTED_PROXY_HOPS`                      | required    | Number of reverse proxies in front of the app that append to `X-Forwarded-For` (0–5). See §7. Must be set explicitly in production, even when it is `0`.                                                             |

**Validation (fail fast).** The server validates the environment when it starts (`instrumentation.ts`), before it serves any request. `npm run ops:seed` and `npm run ops:bootstrap` validate it too. Any problem stops the process with exit code 1 and a list naming each variable and rule, for example:

```
Invalid server environment:
✖ Must not point to localhost in production
  → at APP_URL
```

Messages never contain the values. `next build` only applies the basic format rules, so the build host does not need production secrets, **but it needs format-valid placeholders**: page-data collection loads the database module, and the build fails with `Invalid server environment … DATABASE_URL / AUTH_ACCESS_TOKEN_SECRET / AUTH_REFRESH_TOKEN_SECRET` when they are absent. On a clean build host set throwaway values for the build only, for example `DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build` and two different random 32+ character strings for the auth secrets (CI writes a throwaway `.env` for the same reason). They are not used at run time and must not be the production values. Development and test keep convenient defaults: `APP_URL` falls back to `http://localhost:3000` and `TRUSTED_PROXY_HOPS` to `0`.

**What validation cannot catch.** It refuses placeholders, weak or identical secrets, `http`/localhost `APP_URL` and a missing `TRUSTED_PROXY_HOPS` (all verified against the release, §12). It cannot know where a random secret came from: secrets copied from a developer's `.env` pass. Generate every production secret on the production side (§10) and never copy a development `.env` to a server.

## 3. Install, build, start

Building needs the development tools (TypeScript, Tailwind, esbuild). Running does not. There are two supported layouts.

**A. Build and run on the same host**

```bash
npm ci
npm run build
npm prune --omit=dev
npm run db:deploy
npm run ops:seed
npm start
```

**B. Build elsewhere, ship the artifacts**

On the build host check out the release tag (or `git archive <tag>`; on Windows use `git -c core.autocrlf=false archive …`, otherwise text files are exported with CRLF and the CI-workflow test fails), set the build placeholders (§2), and run `npm ci` and `npm run build`. Then copy these to the server: `package.json`, `package-lock.json`, `prisma.config.ts`, `next.config.ts`, `prisma/`, `.next/` (without `.next/cache` and `.next/dev`), `dist/ops/` and `public/` (if present). On the server run:

```bash
npm ci --omit=dev
npm run db:deploy
npm run ops:seed
npm start
```

What each step does:

- **`npm ci --omit=dev`** installs only runtime dependencies. `postinstall` generates the Prisma client and needs no database credentials. The `prisma` CLI is a runtime dependency on purpose, because it provides client generation and `migrate deploy`. `typescript` still appears in `node_modules` because it is a peer dependency of Prisma, not because of the application.
- **`npm run build`** runs `next build` and then `build:ops`, which compiles `scripts/ops/*.ts` to `dist/ops/*.mjs` so the operational commands run on plain `node`, without tsx.
- **`npm start`** runs `scripts/start.mjs`, which starts `next start` on port 3000 (`-p` changes it) with `NEXT_MANUAL_SIG_HANDLE=true`. That hands SIGTERM / SIGINT to the application's graceful shutdown (readiness 503, streams and job claims stop, in-flight requests finish, pools close; [OPERATIONS.md §10](OPERATIONS.md#10-several-instances-and-graceful-shutdown)). Plain `next start` still works, but closes the server at once on a signal. Give the service manager a stop timeout of at least `SHUTDOWN_TIMEOUT_MS` + 5 s (default 30 s). Put the reverse proxy in front of it.

The production path never runs `tsx`, `vitest`, `dotenv` or the development seed, and nothing seeds on startup.

## 4. Migrations

Migrations are applied **explicitly**, never at startup:

```bash
npm run db:deploy
```

This runs `prisma migrate deploy`. It applies pending migrations from `prisma/migrations` in order, is safe to re-run, and never generates or resets anything. Run it after each release is installed and before `npm start`. Check the state with:

```bash
node node_modules/prisma/build/index.js migrate status
```

`db:migrate` (`migrate dev`) and `db:reset` are development-only and must never point at production.

**Several instances.** Run `db:deploy` once per release, as its own step, never from each instance; no instance runs migrations at startup. In a rolling update the old release keeps serving while the new one starts, so a migration shipped with a rolling release must be compatible with the previous release (add columns, tables and indexes; drop or rename only in a later release). A migration that is not must be deployed with every instance stopped. Applied migrations are never edited.

Migrations connect as the schema owner (`MIGRATION_DATABASE_URL`). They are **not** transactional per file, and they are never rolled back automatically: the policy is to back up first and fix forward. For the safety checklist (explicit `BEGIN`/`COMMIT`, `CREATE INDEX CONCURRENTLY`, batched backfills, `lock_timeout`) and for what to do when a migration fails, see [OPERATIONS.md §3](OPERATIONS.md#3-migrations).

## 5. Reference data and first administrator

### 5.1 Reference data: `npm run ops:seed`

This creates or updates the currencies, the permission catalog and the system role templates. It is idempotent: run it after every `db:deploy`, because a release can add permissions. It contains no demo code. Expected output:

```
Reference data up to date: 9 currencies, 78 permissions, 13 role templates.
```

### 5.2 First organization and administrator: `npm run ops:bootstrap`

A fresh installation has no users, and there is no sign-up page or HTTP bootstrap route. The operator creates the first organization and its administrator once, on the server:

```bash
npm run ops:bootstrap -- --confirm --org-code SERENE --org-name "Serene Hospitality" --currency PKR --admin-email owner@your-hotel.com --admin-name "Owner Name"
```

| Flag               | Env fallback               | Rule                                                          |
| ------------------ | -------------------------- | ------------------------------------------------------------- |
| `--confirm`        | —                          | Required. Without it the command exits 3 and changes nothing. |
| `--org-code`       | `BOOTSTRAP_ORG_CODE`       | 2–20 characters, starting with a letter; stored upper-case.   |
| `--org-name`       | `BOOTSTRAP_ORG_NAME`       | 2–200 characters.                                             |
| `--org-legal-name` | `BOOTSTRAP_ORG_LEGAL_NAME` | Optional.                                                     |
| `--currency`       | `BOOTSTRAP_CURRENCY`       | ISO 4217 code seeded by `ops:seed` (PKR, USD, EUR, …).        |
| `--admin-email`    | `BOOTSTRAP_ADMIN_EMAIL`    | The administrator's sign-in email.                            |
| `--admin-name`     | `BOOTSTRAP_ADMIN_NAME`     | 2–120 characters.                                             |

**Password.** It is never a command-line argument, because arguments end up in shell history and process lists. Supply it in one of two ways:

- **Interactive (preferred).** Run the command in a terminal and type the password twice at a hidden prompt.
- **Non-interactive.** Set `BOOTSTRAP_ADMIN_PASSWORD` for that one command. The script removes it from its environment once read. Clear it from the shell afterwards and do not store it in `.env`.

The password must be 12–256 characters (the same policy as password changes). It is hashed with argon2id and never printed or logged.

Safeguards:

- The command refuses (exit 2, `ALREADY_BOOTSTRAPPED`) if **any** organization exists. It cannot create a second organization or take over an existing installation.
- Concurrent runs are serialized by a database advisory lock, so exactly one can succeed.
- Everything runs in one transaction: the organization, its copied role templates, the administrator and the organization-scope `ORGANIZATION_ADMIN` assignment. If any step fails, nothing is kept.
- It writes a HIGH-risk audit entry `organization.bootstrap` (actor type SYSTEM). The entry contains no password.

Exit codes:

- 0: created.
- 1: unexpected error, for example an invalid environment or an unreachable database.
- 2: refused, with one of these reasons:
  - `ALREADY_BOOTSTRAPPED`
  - `REFERENCE_DATA_MISSING`: run `ops:seed` first.
  - `UNKNOWN_CURRENCY`
  - `EMAIL_TAKEN`
  - invalid input: the field names and rules are listed, never the values.
- 3: `--confirm` missing.

Expected output on success:

```
Organization and administrator created.
  Organization: SERENE (…id…)
  Administrator: owner@your-hotel.com (…id…), role ORGANIZATION_ADMIN
  Sign in at: https://pms.your-hotel.com/login
  Next: Organization → Properties to create the first property.
```

After signing in, the administrator creates the first property under **Organization → Properties**, then users and roles. The organization's first property automatically receives the standard starter setup (ARCHITECTURE D49): transaction codes and payment methods (cash, card, bank transfer), reason, market, source and channel codes, reservation types, cancellation policies, block statuses, housekeeping task types, maintenance categories and the night-audit no-show codes. It is currency-neutral (no prices) and editable afterwards. Taxes, room types, rooms and rate plans are property-specific and still have to be set up. Further properties start empty and copy a sibling's setup before go-live (Property → Setup → copy from, D37). The administrator holds every organization permission (users, roles, properties, reports, …) through the organization-scope assignment.

### 5.3 Demo data (development only)

The demo organization, with its properties, rooms and sample users, comes only from the development seed (`npm run db:seed` with `SEED_DEMO=true`), which needs the development dependencies. Rules:

- It is **refused whenever `NODE_ENV=production`**, and there is no override.
- It requires `SEED_DEMO_PASSWORD`: at least 16 characters, not a placeholder. There is no default or shared demo password, and the password is never printed.
- Without `SEED_DEMO=true` the development seed loads reference data only.

## 6. Health endpoints

All three endpoints are public, uncached (`cache-control: no-store`) and carry `x-request-id`.

| Endpoint            | Checks                      | Success                           | Failure                                                                        | Use for                                  |
| ------------------- | --------------------------- | --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `/api/health/live`  | The process answers. No DB. | 200 `{"data":{"status":"ok"}}`    | No response / 5xx                                                              | Liveness: restart the process if failing |
| `/api/health/ready` | `SELECT 1`, 2 s timeout     | 200 `{"data":{"status":"ready"}}` | 503 `{"status":"unavailable"}`, or `{"status":"draining"}` while shutting down | Readiness: route traffic only when 200   |
| `/api/health`       | Same as `/ready`            | Same as `/ready`                  | Same as `/ready`                                                               | Kept for existing monitors (alias)       |

A failed readiness check never returns database error details. The server log records the error name and code only, with no connection string or credentials, for example `Readiness check failed { name: 'PrismaClientKnownRequestError', code: '3D000' }`. Do not restart the app when readiness fails and liveness passes, because the database is the problem.

## 7. Reverse proxy and `TRUSTED_PROXY_HOPS`

Rate limits and audit entries use the client IP taken from `X-Forwarded-For` (ARCHITECTURE D44). The app trusts exactly `TRUSTED_PROXY_HOPS` entries from the right:

- **`0`**: the app is reached directly. Forwarded headers are ignored and the client IP is unknown. IP-keyed limits are skipped; per-account and per-user limits still apply.
- **`1`**: one proxy (typical nginx) that **appends** the peer address (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).
- **`n`**: that many appending proxies in a chain, for example a CDN in front of nginx.

The value must match the real topology:

- **Too high:** clients can spoof their IP and dodge rate limits.
- **Too low:** every user appears to come from the proxy's address and shares one IP budget.

Do not expose the Node port directly when `TRUSTED_PROXY_HOPS` > 0.

Also forward `Host` and `X-Forwarded-Proto`. Serve only HTTPS, because cookies are `Secure` in production.

**Request size.** The application refuses JSON bodies above 1 MiB with `413 PAYLOAD_TOO_LARGE` before reading them in full (the largest legitimate body, an avatar, is ≈ 350 KB). Keep a matching limit at the proxy (`client_max_body_size 1m;`, the nginx default) so oversized uploads stop there.

**Request ids and metrics** ([OPERATIONS.md §11](OPERATIONS.md#11-observability)): have the proxy set `X-Request-Id` (nginx `proxy_set_header X-Request-Id $request_id;`) so its access log and the application's logs, audit rows and jobs share one id. Set `METRICS_TOKEN` and let the monitoring system scrape `/api/metrics` on every instance directly; do not route it through the public proxy (it answers 404 there without the token anyway).

**Load balancer in front of several instances** ([OPERATIONS.md §10](OPERATIONS.md#10-several-instances-and-graceful-shutdown)): no sticky sessions are needed; health-check `/api/health/ready` (unauthenticated) and remove a target on 503; do not buffer `/api/v1/properties/*/events` (server-sent events: `proxy_buffering off`, read timeout above 25 s, the heartbeat interval); abort the upstream request when the client disconnects (the nginx and HAProxy default) so closed event streams do not stay open on the instance; and count every proxy that appends to `X-Forwarded-For` in `TRUSTED_PROXY_HOPS`.

## 8. Warnings

- Never deploy with values from `.env.example`. Validation rejects `change-me`-style secrets and database passwords, but choose real random values anyway.
- Never set `APP_URL` to localhost in production. Validation stops the server.
- Keep the two auth secrets distinct and private. Rotating `AUTH_ACCESS_TOKEN_SECRET` signs everyone out within the access TTL. Rotating `AUTH_REFRESH_TOKEN_SECRET` signs everyone out immediately and voids reset links.
- Never run `db:migrate`, `db:reset` or `db:seed` against production.
- Restrict who can run `ops:bootstrap` to the server operator; it needs the production environment and database access.
- Never run the application as the schema owner or a superuser in production. The owner can disable the ledger triggers (OPERATIONS.md §4).
- There is no Docker configuration, and none should be added. PostgreSQL runs natively.
- The first deploy of Phase 10's final pass renames the auth cookies (`__Host-`/`__Secure-` prefixes, ARCHITECTURE.md D56): every user signs in once more. Old cookies expire on their own.

## 9. Production deployment runbook

Use this for every release; the first installation follows the same steps plus step 8. Commands run in the application directory, with the production environment loaded.

1. **Preconditions**
   - The release passed CI (OPERATIONS.md §9) and was tested on staging against a restored copy of production (OPERATIONS.md §3.2).
   - Read the release's migrations (`prisma/migrations/*/migration.sql`): note long-running or locking steps, and schedule them off-peak and away from the night audit.
   - Confirm last night's backup exists and verifies (`npm run ops:backup -- list --dir …`).
2. **Environment validation**
   - Set the environment (§2): `DATABASE_URL` for the runtime role and `MIGRATION_DATABASE_URL` for the owner.
   - The server refuses to start on an invalid environment, and so do `ops:seed`, `ops:db-check` and `ops:maintenance`. Nothing needs to be checked by hand beyond reading their output.
3. **Database backup** — only if the release contains migrations, but it is cheap enough to do every time:
   ```bash
   npm run ops:backup -- create --out-dir /var/backups/serene
   npm run ops:backup -- verify --file <the file just created>
   ```
   Note the file name. It is the fallback in step 10.
4. **Install the release**
   - Layout A: `npm ci` → `npm run build` → `npm prune --omit=dev`.
   - Layout B: copy the artifacts, then `npm ci --omit=dev` (§3).
5. **Prisma client generation.** `postinstall` runs `prisma generate` during `npm ci`. It needs no database access and no credentials, and it must finish without errors. There is no separate step.
6. **Migrations**
   ```bash
   npm run db:deploy
   npm run ops:seed
   ```
   - `db:deploy` must end with `All migrations have been successfully applied` (or report nothing to apply).
   - If it fails, stop and follow OPERATIONS.md §3.4. Do not start the new release against a half-migrated database.
7. **Start.** Restart the service, for example `systemctl restart serene` running `npm start`. The process exits immediately, with the list of problems, if the environment is invalid.
8. **First installation only.** Create the runtime role (OPERATIONS.md §4), run `npm run ops:bootstrap -- --confirm …` (§5.2), then sign in and create the first property. Schedule backups and maintenance (OPERATIONS.md §8). Background jobs run inside the application by default; to run separate workers see OPERATIONS.md §7.
9. **Health and smoke checks**
   - Wait for `/api/health/ready` to return 200 before routing traffic (§6). `/api/health/live` must return 200 throughout.
   - `npm run ops:db-check -- --strict`: no `FAIL` or `WARN` lines (guards enabled, UTC session, no failed migrations, runtime role is not the owner).
   - Sign in. Open the room rack for today's business date. Open one in-house folio. Run one report for the last closed date. Sign out.
10. **Rollback and recovery.** Migrations are never rolled back automatically (OPERATIONS.md §3.2).
    - **The application misbehaves and the schema is unchanged or backward compatible** (expand/contract): redeploy the previous release's artifacts and restart.
    - **A migration failed or corrupted data:** keep the application stopped and follow OPERATIONS.md §3.4. If data is damaged, restore the step-3 backup into a new database and switch over (OPERATIONS.md §2.4), then redeploy the previous release.
    - **Otherwise,** fix forward with a corrective migration in a new release.
11. **Post-deployment verification**
    - Watch the logs and `/api/health/ready` for the first hour.
    - Confirm the next scheduled backup and maintenance runs succeed.
    - After the next night audit, check that the business date rolled and that `ops:db-check` is still clean.
    - Record the release, the backup file name and any issues.

## 10. Production configuration checklist

Every variable the release reads (`lib/env.ts`), with the production rule. **W** = web instances, **K** = worker processes. Keep the file that holds them (`EnvironmentFile=` in systemd, or the service manager's secret store) readable only by the service account (mode 600). Never print the values; generate secrets on the production side with `openssl rand -base64 48`.

| Variable                                                                                                  | W   | K   | Production value / rule                                                                                                                                            | Enforced at start                          |
| --------------------------------------------------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `NODE_ENV`                                                                                                | ✓   | ✓   | `production`                                                                                                                                                       | —                                          |
| `APP_URL`                                                                                                 | ✓   | ✓   | The canonical public `https://` origin. Writes are refused unless `Origin` equals it; cookies are `__Host-` and `Secure`                                           | https, not localhost                       |
| `DATABASE_URL`                                                                                            | ✓   | ✓   | **Runtime role** (not the schema owner) on the production database. Add `?sslmode=verify-full&sslrootcert=…` when PostgreSQL is on another host                    | real password                              |
| `MIGRATION_DATABASE_URL`                                                                                  | —   | —   | Schema owner, only where `db:deploy` and `ops:backup` run; never in the web or worker environment                                                                  | URL format                                 |
| `AUTH_ACCESS_TOKEN_SECRET`                                                                                | ✓   | ✓   | 48 random bytes, base64; the same value on every instance                                                                                                          | ≥ 32 characters, random, not a placeholder |
| `AUTH_REFRESH_TOKEN_SECRET`                                                                               | ✓   | ✓   | Different 48 random bytes; the same on every instance. Rotating it signs everyone out                                                                              | differs from the access secret             |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                                                                           | ✓   | ✓   | Default 900                                                                                                                                                        | 60–3600                                    |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                                                                          | ✓   | ✓   | Default 1209600 (14 days)                                                                                                                                          | longer than the access TTL                 |
| `FIELD_ENCRYPTION_KEY`                                                                                    | ✓   | ✓   | 32 random bytes, base64 (`openssl rand -base64 32`). Reserved for encrypted guest fields: set it now and keep it with the secrets, never with the database backups | 32 bytes when set                          |
| `TRUSTED_PROXY_HOPS`                                                                                      | ✓   | ✓   | Proxies that append to `X-Forwarded-For` (one TLS load balancer: `1`; CDN + load balancer: `2`). Instances must be reachable only through that chain               | must be set                                |
| `METRICS_TOKEN`                                                                                           | ✓   | ✓   | 36+ random bytes: the scraper's bearer token. Unset = `/api/metrics` answers 404                                                                                   | random when set                            |
| `INSTANCE_ID`                                                                                             | ✓   | ✓   | Unique per process, e.g. `web-1`, `worker-1` (logs and metrics; no secrets)                                                                                        | pattern                                    |
| `JOB_WORKER`                                                                                              | ✓   | ✓   | `off` on web instances when separate workers run; `inline` in worker processes and on a single server                                                              | enum                                       |
| `JOB_WORKER_CONCURRENCY`, `JOB_LEASE_MS`, `JOB_POLL_INTERVAL_MS`                                          | —   | ✓   | Defaults 1 / 60000 / 5000                                                                                                                                          | ranges                                     |
| `RATE_LIMIT_STORE`                                                                                        | ✓   | —   | `postgres` (default). `memory` only with a single instance: the application cannot detect other instances, so this is an operator check                            | enum only                                  |
| `REALTIME_ENABLED`                                                                                        | ✓   | —   | `1` (default); `0` makes every screen poll                                                                                                                         | enum                                       |
| `REALTIME_DATABASE_URL`                                                                                   | ✓   | —   | Only with PgBouncer in transaction mode: a direct (session) URL for LISTEN                                                                                         | required in that mode                      |
| `DATABASE_POOLER`                                                                                         | ✓   | ✓   | `none`, or `pgbouncer-transaction` when `DATABASE_URL` points at PgBouncer (OPERATIONS §6)                                                                         | enum                                       |
| `DATABASE_POOL_MAX`                                                                                       | ✓   | ✓   | Web 10, workers 4 in the reference topology (budget in §11)                                                                                                        | 1–50                                       |
| `DATABASE_POOL_MIN`, `DATABASE_POOL_IDLE_TIMEOUT_MS`, `DATABASE_POOL_MAX_LIFETIME_S`                      | ✓   | ✓   | Defaults 0 / 120000 / 0                                                                                                                                            | ranges                                     |
| `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | ✓   | ✓   | Defaults 5000 / 30000 / 60000                                                                                                                                      | ranges                                     |
| `READ_DATABASE_URL`, `READ_DATABASE_POOL_MAX`, `READ_REPLICA_MAX_LAG_MS`                                  | ✓   | —   | Only when a streaming standby is provisioned (OPERATIONS §6); unset otherwise                                                                                      | URL format                                 |
| `SEARCH_CONCURRENCY`                                                                                      | ✓   | —   | Default 3                                                                                                                                                          | 1–8                                        |
| `REPORT_HEAVY_CONCURRENCY`, `REPORT_HEAVY_WAIT_MS`                                                        | ✓   | —   | Defaults 1 / 30000                                                                                                                                                 | ranges                                     |
| `SHUTDOWN_DRAIN_MS`, `SHUTDOWN_TIMEOUT_MS`                                                                | ✓   | ✓   | 5000 / 25000; `SHUTDOWN_DRAIN_MS` ≥ health-check interval × unhealthy threshold                                                                                    | ranges                                     |
| `SLOW_REQUEST_MS`                                                                                         | ✓   | —   | Default 2000                                                                                                                                                       | range                                      |
| `SERVER_TIMING`                                                                                           | ✓   | —   | **`0` (the default) in production.** `1` sends per-request timings and the instance id to clients: load tests only                                                 | enum                                       |
| `NEXT_MANUAL_SIG_HANDLE`                                                                                  | ✓   | —   | Set by `npm start` (`scripts/start.mjs`): start web instances through it, not plain `next start`                                                                   | —                                          |
| `BOOTSTRAP_*`                                                                                             | —   | —   | Only for the single `ops:bootstrap` run (§5.2); never in a service environment                                                                                     | —                                          |
| `SEED_DEMO`, `SEED_DEMO_PASSWORD`                                                                         | —   | —   | Never in production (the demo seed refuses `NODE_ENV=production`)                                                                                                  | refused                                    |

Offline mode needs no server variable: the read-only offline copy lives in the browser (OFFLINE_ARCHITECTURE.md).

## 11. Reference production topology

```
Internet ──▶ DNS pms.<hotel-domain> ──▶ TLS load balancer (nginx / HAProxy / cloud LB; 80 → 301 https)
                                         │  X-Forwarded-For (append), X-Forwarded-Proto, X-Request-Id
                          ┌──────────────┴──────────────┐
                    web-1 :3000 (JOB_WORKER=off)   web-2 :3000 (JOB_WORKER=off)      ← private network only
                          └──────────────┬──────────────┘
                     PostgreSQL 17/18 (runtime role) ◀── worker-1, worker-2 (npm run worker, metrics :9101)
                                         ▲
                     backups: ops:backup (schema owner) → gpg → off-host storage
Monitoring: Prometheus scrapes /api/metrics on each web instance and /metrics on each worker directly (bearer token)
```

**Connection budget** (OPERATIONS §6; `ops:db-check` prints it): 2 web × (10 + 1 LISTEN) + 2 workers × (4 + 1) + one web instance of rolling-update surge (11) + 10 for migrations, backups, monitoring and administrators = 53, inside `max_connections` 100 − 3 reserved. Give the runtime role a `CONNECTION LIMIT` (for example 60) so a runaway pool cannot exhaust the server.

**Database roles.** The schema owner and the runtime role are separate (OPERATIONS §4). Only role creation needs a superuser. After that, the owner runs the migrations and the grants in `scripts/db/runtime-grants.sql`, except its final `ALTER ROLE … SET` lines: those need `CREATEROLE` and belong in the superuser step. When PostgreSQL is on another host, enable `ssl = on`, allow only `hostssl … scram-sha-256` in `pg_hba.conf` for both roles, and use `sslmode=verify-full` in the URLs.

**nginx.** Open-source nginx has passive health checks only. To drain an instance, remove it from `upstream` and reload before stopping it, or use HAProxy or a cloud load balancer with active readiness checks.

```nginx
upstream serene_web {
    server 10.0.0.11:3000 max_fails=2 fail_timeout=10s;
    server 10.0.0.12:3000 max_fails=2 fail_timeout=10s;
    keepalive 32;
}
server {
    listen 80;
    server_name pms.example-hotel.com;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name pms.example-hotel.com;
    ssl_certificate     /etc/letsencrypt/live/pms.example-hotel.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pms.example-hotel.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    client_max_body_size 1m;                 # the application also refuses larger JSON bodies with 413
    keepalive_timeout 75s;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # TRUSTED_PROXY_HOPS=1
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-Id $request_id;
    proxy_connect_timeout 5s;
    proxy_read_timeout 75s;
    proxy_next_upstream error timeout;        # nginx never retries non-idempotent requests by default
    # Security headers (HSTS, CSP, X-Frame-Options, nosniff, COOP, Referrer/Permissions-Policy) come from the application.

    location ~ ^/api/v1/properties/[^/]+/events$ {      # server-sent events
        proxy_pass http://serene_web;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;              # longer than the 25 s heartbeat
    }
    location = /api/metrics { return 404; }   # scrape instances directly, never through the public proxy
    location / { proxy_pass http://serene_web; }
}
```

**HAProxy** (active readiness checks; it drains an instance automatically when it answers 503 `draining`):

```haproxy
backend serene_web
    option httpchk GET /api/health/ready
    http-check expect status 200
    default-server inter 1s fall 2 rise 2
    timeout server 120s                       # covers the SSE heartbeat (25 s)
    http-request set-header X-Forwarded-Proto https
    option forwardfor                          # appends X-Forwarded-For; TRUSTED_PROXY_HOPS=1
    server web1 10.0.0.11:3000 check
    server web2 10.0.0.12:3000 check
```

Validate the real file with `nginx -t` or `haproxy -c -f …` on the proxy host: these examples were not run through either tool (the rehearsal used a stand-in proxy, §12).

**systemd units** (Linux; on Windows use NSSM with `AppStopMethodConsole` and the same timeouts):

```ini
# /etc/systemd/system/serene-web@.service   (instance name = port, e.g. serene-web@3000)
[Unit]
Description=SERENE MANAGEMENT web %i
After=network-online.target
[Service]
User=serene
WorkingDirectory=/srv/serene/current
EnvironmentFile=/etc/serene/serene.env
Environment=INSTANCE_ID=web-%H-%i JOB_WORKER=off
ExecStart=/usr/bin/node scripts/start.mjs -p %i -H 0.0.0.0
KillSignal=SIGTERM
# SHUTDOWN_TIMEOUT_MS + 5 s + margin
TimeoutStopSec=35
Restart=on-failure
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target

# /etc/systemd/system/serene-worker@.service   (instance name = metrics port, e.g. serene-worker@9101)
[Unit]
Description=SERENE MANAGEMENT worker %i
After=network-online.target
[Service]
User=serene
WorkingDirectory=/srv/serene/current
EnvironmentFile=/etc/serene/serene.env
Environment=INSTANCE_ID=worker-%H-%i JOB_WORKER=inline DATABASE_POOL_MAX=4
ExecStart=/usr/bin/node --conditions=react-server dist/ops/worker.mjs --metrics-port %i
KillSignal=SIGTERM
# The worker waits up to 60 s for running jobs; systemd kills it after this (OPERATIONS §7)
TimeoutStopSec=90
Restart=on-failure
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
```

`/srv/serene/current` is a symlink to `/srv/serene/releases/<version>`: a deploy or a rollback switches the link and restarts the units one at a time (OPERATIONS §12.2).

**Firewall.** Only the load balancer reaches the web ports, only the monitoring host reaches the metrics ports, and only application hosts, the backup host and administrators reach PostgreSQL (5432).

**Domain and TLS checklist (before go-live).**

- DNS `A`/`AAAA` records for the public name point at the load balancer; keep the TTL low during the first week.
- A publicly trusted certificate for exactly that name (ACME/Let's Encrypt or the hotel's CA), with automatic renewal and an expiry alert at 14 days.
- `http://` answers 301 to `https://`, and `APP_URL` is that exact `https://` origin (scheme, host, port).
- After the first sign-in the browser holds `__Host-sm_at` and `__Host-sm_s`: `Secure; HttpOnly; SameSite=Lax; Path=/`.
- There are no OAuth or SSO callbacks: sign-in redirects stay on `APP_URL` (`/login?next=…`).
- The application already sends `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Consider HSTS preload only after the name has served HTTPS correctly for weeks.

## 12. Release rehearsal: v1.0.0-rc1 (2026-10-03)

The exact tag (`cb41640`) was exported with `git archive`, installed with `npm ci`, verified with `npm run verify` (872/872 tests) and `format:check`, then built and pruned (layout A). It ran in the §11 topology on one Windows host:

- a stand-in TLS load balancer (a rehearsal tool modelling the nginx/HAProxy rules above: TLS 1.3, readiness checks, 1 MiB limit, unbuffered SSE, `X-Request-Id`) with a certificate from a private CA;
- 2 web instances and 2 separate workers;
- native PostgreSQL 18, on a copy of the demo dataset (fictional guests).

| Area                      | Result                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations                | 27 applied, none pending, none failed. Fresh install from an empty database in 3.6 s, then `ops:seed` and `ops:bootstrap` (a second run is refused, exit 2)                                                                                                                           |
| Drift                     | Live schema vs Prisma schema: one difference, a false positive (PostgreSQL stores the `background_jobs` partial unique index predicate in normalized form)                                                                                                                            |
| Environment validation    | 7 unsafe configurations refused at start: localhost or http `APP_URL`, missing `TRUSTED_PROXY_HOPS`, placeholder or identical secrets, weak metrics token, placeholder database password. Development secrets are accepted (§2)                                                       |
| HTTPS and headers         | TLS 1.3 verified against the CA; 301 from http to https; HSTS, nonce CSP, `X-Frame-Options: DENY`, `nosniff`, COOP, Referrer- and Permissions-Policy; a 2 MB body gets 413 at the proxy                                                                                               |
| Cookies                   | `__Host-sm_at` and `__Host-sm_s`: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only; cleared on sign-out                                                                                                                                                                      |
| Smoke test (20 steps)     | Login, property, guest, reservation, availability, arrival, check-in, room move, housekeeping, charge, payment (idempotent retry), check-out, night audit on a separate worker, reports and CSV, search, property switching, sign-out, permission revocation (stream ended): all pass |
| Browser                   | 32 routes through the proxy: no console, hydration or request errors; 0 axe violations; offline and reconnect work. The `/design-system` catalogue is not served (not-found page, HTTP 200 because the response streams)                                                              |
| Instance failure          | k6 through the proxy: a hard kill of one instance and a graceful drain of the other under load, 0 failed requests of 19 557 (4 in-flight GETs retried by the proxy)                                                                                                                   |
| Worker failure            | A worker killed while holding a job: the job was reclaimed after the 60 s lease and finished exactly once. Graceful worker stops exit 0                                                                                                                                               |
| Database interruption     | Connections refused for 15 s: readiness 503, a clean 503 from the proxy, recovery within 1 s without restarts. A 20 s network partition: 0 failed requests of 14 383; requests completed after it                                                                                     |
| Proxy restart             | Event streams reconnect within 0.4 s. A screen whose request failed during the outage shows "Cannot reach the server · Retry" until retried (OPERATIONS §10)                                                                                                                          |
| Rollback and roll-forward | The previous release (`a70992d`, same schema) rolled in and out one instance at a time under load: 0 failed requests of 27 002 and 28 442                                                                                                                                             |
| Backup and restore        | `ops:backup`, gpg encryption (public key only on the server), off-host copy. Restore drill from the encrypted copy into a new database in 3 s (0.6 MB); row counts identical; an instance on it was ready in 0.5 s and sign-in worked                                                 |

Not covered by the rehearsal (it ran on one host): a real public DNS name and certificate, separate hosts and networks, a real nginx/HAProxy/cloud load balancer, PgBouncer, a read replica, PostgreSQL TLS, real off-site storage, and the dedicated owner/runtime roles (the rehearsal's application role owned the schema, so `ops:db-check --strict` reported its two role warnings).
