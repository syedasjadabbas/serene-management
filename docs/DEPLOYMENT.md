# Deployment

How to install, configure, start and verify SERENE MANAGEMENT on servers. **Docker is not used** and PostgreSQL runs natively.

**As of the server split (2026-11-12, [SERVER_SPLIT_PLAN.md](SERVER_SPLIT_PLAN.md)) there are two application processes plus optional workers.** The Express **API server** (`server/`, port 4000 by default, `/api/v1`, health and metrics under `/api`) and the Next.js **client** (`client/`, port 3000, no API routes) are built and started separately; background jobs run in the API process (`JOB_WORKER=inline`) or in separate `npm run worker` processes. Deploy order: **migrate, then server, then client**. Two layouts are supported:

- **Single server:** one API process (web requests and background jobs, `JOB_WORKER=inline`) and one client process behind a TLS reverse proxy, with PostgreSQL on the same or another host.
- **Production topology (§11):** a TLS reverse proxy / load balancer in front of two or more stateless API instances (`JOB_WORKER=off`), one or more client instances, separate worker processes (`npm run worker`), one shared PostgreSQL. Sessions are cached per instance for at most 10 s without Redis, or shared when `REDIS_URL` is set; rate limits, jobs and live-update fan-out live in PostgreSQL, so no sticky sessions or broker are needed and **Redis is optional**. Live updates use server-sent events, which the proxy must not buffer.

PgBouncer and a read replica are optional and enabled only when provisioned (OPERATIONS.md §6). The full variable checklist is §10, the reference proxy and service configuration §11, and the release rehearsal of v1.0.0-rc1 §12.

Related: [OPERATIONS.md](OPERATIONS.md) (backups, restore drill, migration policy, database roles, retention, pool settings, scheduling, CI), [ARCHITECTURE.md](ARCHITECTURE.md) (D44 client IP, D48 deployment, D50–D53 operations), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [RBAC.md](RBAC.md).

## 1. Requirements

- Node.js ≥ 22.12.
- PostgreSQL 17+ as a native service on the host or a reachable server, with `psql`.
- Two database roles, neither a superuser (OPERATIONS.md §4). The **schema owner** owns the database and runs migrations and backups. The **runtime role** is created by `scripts/db/runtime-role.sql` and is what the application connects as. On Windows, `npm run db:setup` creates the owner role and the databases from `DATABASE_URL` (a single-role setup, fine for development). On Linux, create them with `createuser` / `createdb`.
- The PostgreSQL client tools `psql`, `pg_dump` and `pg_restore`, in the server's major version or newer, for the role script and the backups.
- TLS termination on the reverse proxy. The API only accepts `https://` `CLIENT_ORIGINS` in production.
- Serve the client and the API from the same site (for example `pms.example.com` and `api.example.com`, or one host with `/api` routed to the API, §11): the refresh cookie is `SameSite=Strict`, so a client on a different registrable domain could not use it.
- Redis is optional (`REDIS_URL`). Without it every API instance keeps its own session and permission caches (TTL at most 10 s).

## 2. Environment variables

The API server reads the process environment (systemd unit, Windows service, process manager) or a `server/.env` file; a repository-root `.env` is still read as a fallback. Real environment variables win over the files. Never commit `.env`. `server/.env.example` lists every server variable; the client needs only `NEXT_PUBLIC_API_URL` (`client/.env.example`, §3). The root `.env.example` is a pointer to both.

| Variable                                          | Production  | Rule                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                        | required    | `production`. Set it for the API, the worker and the ops commands (the client's `next start` sets it itself).                                                                                                                                                                              |
| `DATABASE_URL`                                    | required    | The **runtime role's** `postgresql://user:password@host:5432/db`. The password must be real (no `change-me`, not empty).                                                                                                                                                                   |
| `AUTH_ACCESS_TOKEN_SECRET`                        | required    | ≥ 32 characters, random (`openssl rand -base64 48`). No placeholder text.                                                                                                                                                                                                                  |
| `AUTH_REFRESH_TOKEN_SECRET`                       | required    | Same rules, and **different** from the access secret. It also peppers refresh and password-reset token hashes: changing it signs everyone out and invalidates outstanding reset links.                                                                                                     |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                   | optional    | 60–3600, default 900.                                                                                                                                                                                                                                                                      |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                  | optional    | 3600–7776000 (90 days), default 1209600 (14 days). Must be longer than the access TTL.                                                                                                                                                                                                     |
| `FIELD_ENCRYPTION_KEY`                            | optional    | When set, 32 random bytes in base64 (`openssl rand -base64 32`). Reserved for encrypting sensitive guest fields.                                                                                                                                                                           |
| `PORT`                                            | optional    | Port of the API server, default 4000.                                                                                                                                                                                                                                                      |
| `REDIS_URL`                                       | optional    | `redis://` or `rediss://`. Shares the session and permission caches between API instances. Unset: per-process memory caches with TTL at most 10 s. A Redis outage falls back to memory.                                                                                                    |
| `SESSION_CACHE_TTL_MS`, `PERMISSION_CACHE_TTL_MS` | optional    | 0–300000. Default 30 s with Redis, 10 s in memory.                                                                                                                                                                                                                                         |
| `CLIENT_ORIGINS`                                  | required    | Comma-separated browser origins of the web app, `https://…` with no path or trailing slash, not `localhost`. They are the CORS allowlist and the `Origin` allowlist of `/auth/refresh` and `/auth/logout`; the first is used for sign-in and password-setup links. **Replaces `APP_URL`.** |
| `MIGRATION_DATABASE_URL`                          | recommended | The schema owner's connection, used only by `db:deploy`, `migrate status` and `ops:backup`. When unset, `DATABASE_URL` is used for everything; `ops:db-check` then warns, because the application runs as the owner.                                                                       |
| `READ_DATABASE_URL`                               | optional    | A streaming standby for closed-date reports only; unset (the default) keeps every query on the primary. Prerequisites: OPERATIONS.md §6, SCALABILITY.md §35.                                                                                                                               |
| `DATABASE_POOL_MAX`                               | optional    | Connections per process, 1–50, default 10. Do not raise it to fix slowness (OPERATIONS.md §6).                                                                                                                                                                                             |
| `DATABASE_CONNECT_TIMEOUT_MS`                     | optional    | 500–60000, default 5000.                                                                                                                                                                                                                                                                   |
| `DATABASE_STATEMENT_TIMEOUT_MS`                   | optional    | 1000–600000, default 30000. The night audit commit raises its own limit.                                                                                                                                                                                                                   |
| `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS`         | optional    | 1000–3600000, default 60000.                                                                                                                                                                                                                                                               |
| `TRUSTED_PROXY_HOPS`                              | required    | Number of reverse proxies in front of the app that append to `X-Forwarded-For` (0–5). See §7. Must be set explicitly in production, even when it is `0`.                                                                                                                                   |

**Validation (fail fast).** The API server validates the environment when it starts (`server/index.ts` through `server/config/env.ts`), before it serves any request. `npm run ops:seed` and `npm run ops:bootstrap` validate it too. Any problem stops the process with exit code 1 and a list naming each variable and rule, for example:

```
Invalid server environment:
✖ Must not point to localhost in production
  → at CLIENT_ORIGINS
```

Messages never contain the values. The server build (esbuild) does not read the environment, so the build host needs no production secrets. The client build inlines `NEXT_PUBLIC_API_URL` at **build time**: build the client with the production API URL (for example `NEXT_PUBLIC_API_URL=https://pms.example.com/api/v1 npm run build`), and rebuild to change it. That value is also the `connect-src` origin of the client's Content-Security-Policy. It must not contain a secret.

**What validation cannot catch.** It refuses placeholders, weak or identical secrets, `http`/localhost `CLIENT_ORIGINS` and a missing `TRUSTED_PROXY_HOPS` (all verified against the release, §12). It cannot know where a random secret came from: secrets copied from a developer's `.env` pass. Generate every production secret on the production side (§10) and never copy a development `.env` (or `server/.env`) to a server.

## 3. Install, build, start

Building needs the development tools (TypeScript, Tailwind, esbuild). Running does not. `npm run build` at the repository root builds both applications: the API server bundle (`server/dist/index.mjs`), the worker (`server/dist/workers/worker.mjs`), the operator scripts (`server/dist/ops/*.mjs`) and the client (`client/.next`). There are two supported layouts.

**A. Build and run on the same host**

```bash
npm ci
NEXT_PUBLIC_API_URL=https://pms.example.com/api/v1 npm run build
npm prune --omit=dev
npm run db:deploy
npm run ops:seed -- --apply --yes --database <database name>
npm start -w server      # API on :4000
npm start -w client      # client on :3000
```

**B. Build elsewhere, ship the artifacts**

On the build host check out the release tag (or `git archive <tag>`; on Windows use `git -c core.autocrlf=false archive …`, otherwise text files are exported with CRLF and the CI-workflow test fails), set `NEXT_PUBLIC_API_URL`, and run `npm ci` and `npm run build`. Then copy to the server: the root `package.json` and `package-lock.json`, `shared/` (the workspace package), and from `server/`: `package.json`, `prisma.config.ts`, `prisma/`, `scripts/db/` and `dist/`; from `client/`: `package.json`, `next.config.ts`, `.next/` (without `.next/cache` and `.next/dev`) and `public/`. (This file list was derived from the build outputs and has not been rehearsed since the split; confirm it on a staging host.) On the server run:

```bash
npm ci --omit=dev
npm run db:deploy
npm run ops:seed -- --apply --yes --database <database name>
npm start -w server
npm start -w client
```

What each step does:

- **`npm ci --omit=dev`** installs only runtime dependencies for all workspaces. `postinstall` generates the Prisma client and needs no database credentials. The `prisma` CLI is a runtime dependency of `server` on purpose, because it provides client generation and `migrate deploy`.
- **`npm run build`** runs the `build` script of every workspace: the server (`scripts/build.mjs` bundles `index.ts` to `dist/index.mjs`; `scripts/ops/build.mjs` compiles the operator scripts and the worker) and `next build` for the client. The ops commands and the worker therefore run on plain `node`, without tsx. There is no `--conditions=react-server` flag any more.
- **`npm start -w server`** runs `node dist/index.mjs`. The process installs its own SIGTERM / SIGINT handlers: readiness answers 503, streams and job claims stop, in-flight requests finish, pools close ([OPERATIONS.md §10](OPERATIONS.md#10-several-instances-and-graceful-shutdown)). Give the service manager a stop timeout of at least `SHUTDOWN_TIMEOUT_MS` + 5 s (default 30 s). The old `scripts/start.mjs` launcher and `NEXT_MANUAL_SIG_HANDLE` no longer exist.
- **`npm start -w client`** runs `next start` on port 3000 (`-p` changes it). It serves pages only and holds no secrets and no session.

Put the reverse proxy in front of both (§11). The production path never runs `tsx`, `vitest`, `dotenv` or the development seed, and nothing seeds on startup.

## 4. Migrations

Migrations are applied **explicitly**, never at startup:

```bash
npm run db:deploy
```

This runs `prisma migrate deploy`. It applies pending migrations from `server/prisma/migrations` in order, is safe to re-run, and never generates or resets anything. Run it after each release is installed and before the server starts. Check the state with:

```bash
node node_modules/prisma/build/index.js migrate status --config server/prisma.config.ts
```

`db:migrate` (`migrate dev`) and `db:reset` are development-only and must never point at production. **Naming:** migration folders are dated ahead of the calendar, so a new one must sort after the last existing one (currently `20261227090000_auth_session_platform`); name it with a later timestamp, not today's date.

**Several instances.** Run `db:deploy` once per release, as its own step, never from each instance; no instance runs migrations at startup. In a rolling update the old release keeps serving while the new one starts, so a migration shipped with a rolling release must be compatible with the previous release (add columns, tables and indexes; drop or rename only in a later release). A migration that is not must be deployed with every instance stopped. Applied migrations are never edited.

Migrations connect as the schema owner (`MIGRATION_DATABASE_URL`). They are **not** transactional per file, and they are never rolled back automatically: the policy is to back up first and fix forward. For the safety checklist (explicit `BEGIN`/`COMMIT`, `CREATE INDEX CONCURRENTLY`, batched backfills, `lock_timeout`) and for what to do when a migration fails, see [OPERATIONS.md §3](OPERATIONS.md#3-migrations).

## 5. Reference data and first administrator

### 5.1 Reference data: `npm run ops:seed`

This creates or updates the currencies, the permission catalog and the system role templates. It is idempotent: run it after every `db:deploy`, because a release can add permissions. It contains no demo code. **It is a dry run by default** (it reports what it would change and writes nothing); to write, pass `npm run ops:seed -- --apply --yes --database <name>`, where `<name>` must equal the connected database (§5.2 explains the guard). Expected output after a write:

```
Reference data up to date: 9 currencies, 78 permissions, 13 role templates.
```

### 5.2 First organization and administrator: `npm run ops:bootstrap`

A fresh installation has no users, and there is no sign-up page or HTTP bootstrap route. The operator creates the first organization and its administrator once, on the server:

```bash
npm run ops:bootstrap -- --apply --yes --database serene_management --org-code SERENE --org-name "Serene Hospitality" --currency PKR --admin-email owner@your-hotel.com --admin-name "Owner Name"
```

| Flag               | Env fallback               | Rule                                                                                                                                                         |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--apply --yes`    | —                          | Required to write. Without both it is a dry run: it only reports whether the database is still empty. `--confirm` is a deprecated alias for `--apply --yes`. |
| `--database`       | `OPS_EXPECTED_DATABASE`    | Required to write. Must equal the connected database (`current_database()`), or the command refuses.                                                         |
| `--org-code`       | `BOOTSTRAP_ORG_CODE`       | 2–20 characters, starting with a letter; stored upper-case.                                                                                                  |
| `--org-name`       | `BOOTSTRAP_ORG_NAME`       | 2–200 characters.                                                                                                                                            |
| `--org-legal-name` | `BOOTSTRAP_ORG_LEGAL_NAME` | Optional.                                                                                                                                                    |
| `--currency`       | `BOOTSTRAP_CURRENCY`       | ISO 4217 code seeded by `ops:seed` (PKR, USD, EUR, …).                                                                                                       |
| `--admin-email`    | `BOOTSTRAP_ADMIN_EMAIL`    | The administrator's sign-in email.                                                                                                                           |
| `--admin-name`     | `BOOTSTRAP_ADMIN_NAME`     | 2–120 characters.                                                                                                                                            |

**Operator-script safety.** Every operator command that writes (`ops:seed`, `ops:bootstrap`, `ops:maintenance`, and `ops:backup restore`) is a dry run unless given `--apply --yes`, and a write also needs `--database <name>` (or `OPS_EXPECTED_DATABASE`) equal to the connected database. Half of the pair (`--apply` without `--yes`, or the reverse) is refused rather than silently ignored; refusals exit 2. In production a database whose name ends in `_test` is never written. Set `OPS_EXPECTED_DATABASE` in the shell that runs a production write, not in a shared `.env`. (`ops:backup restore` uses its own `--target-db` / `--confirm-target` guard.)

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
  - wrong or missing database name for a write, or a `_test` database in production.

Expected output on success:

```
Organization and administrator created.
  Organization: SERENE (…id…)
  Administrator: owner@your-hotel.com (…id…), role ORGANIZATION_ADMIN
  Sign in at: https://pms.your-hotel.com/login   (built from the first CLIENT_ORIGINS entry)
  Next: Organization → Properties to create the first property.
```

After signing in, the administrator creates the first property under **Organization → Properties**, then users and roles. The organization's first property automatically receives the standard starter setup (ARCHITECTURE D49): transaction codes and payment methods (cash, card, bank transfer), reason, market, source and channel codes, reservation types, cancellation policies, block statuses, housekeeping task types, maintenance categories and the night-audit no-show codes. It is currency-neutral (no prices) and editable afterwards. Taxes, room types, rooms and rate plans are property-specific and still have to be set up. Further properties start empty and copy a sibling's setup before go-live (Property → Setup → copy from, D37). The administrator holds every organization permission (users, roles, properties, reports, …) through the organization-scope assignment.

### 5.3 Demo data (development only)

The demo organization, with its properties, rooms and sample users, comes only from the development seed (`npm run db:seed` with `SEED_DEMO=true`), which needs the development dependencies. Rules:

- It is **refused whenever `NODE_ENV=production`**, and there is no override.
- It requires `SEED_DEMO_PASSWORD`: at least 16 characters, not a placeholder. There is no default or shared demo password, and the password is never printed.
- Without `SEED_DEMO=true` the development seed loads reference data only.

## 6. Health endpoints

All three endpoints are served by the API server (not the client), are public, uncached (`cache-control: no-store`) and carry `x-request-id`.

| Endpoint            | Checks                      | Success                                          | Failure                                                                                       | Use for                                  |
| ------------------- | --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `/api/health/live`  | The process answers. No DB. | 200 `{"success":true,"data":{"status":"ok"}}`    | No response / 5xx                                                                             | Liveness: restart the process if failing |
| `/api/health/ready` | `SELECT 1`, 2 s timeout     | 200 `{"success":true,"data":{"status":"ready"}}` | 503 in the error envelope with `data.status` `unavailable`, or `draining` while shutting down | Readiness: route traffic only when 200   |
| `/api/health`       | Same as `/ready`            | Same as `/ready`                                 | Same as `/ready`                                                                              | Kept for existing monitors (alias)       |

A failed readiness check never returns database error details. The server log records the error name and code only, with no connection string or credentials, for example `Readiness check failed { name: 'PrismaClientKnownRequestError', code: '3D000' }`. Do not restart the app when readiness fails and liveness passes, because the database is the problem.

## 7. Reverse proxy and `TRUSTED_PROXY_HOPS`

Rate limits and audit entries use the client IP taken from `X-Forwarded-For` (ARCHITECTURE D44). The app trusts exactly `TRUSTED_PROXY_HOPS` entries from the right:

- **`0`**: the app is reached directly. Forwarded headers are ignored and the client IP is unknown. IP-keyed limits are skipped; per-account and per-user limits still apply.
- **`1`**: one proxy (typical nginx) that **appends** the peer address (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).
- **`n`**: that many appending proxies in a chain, for example a CDN in front of nginx.

The value must match the real topology:

- **Too high:** clients can spoof their IP and dodge rate limits.
- **Too low:** every user appears to come from the proxy's address and shares one IP budget.

Do not expose the API's Node port directly when `TRUSTED_PROXY_HOPS` > 0.

Also forward `Host` and `X-Forwarded-Proto`. Serve only HTTPS, because the refresh cookie is `Secure` in production. The `TRUSTED_PROXY_HOPS` rule applies to the API server; the client needs no forwarded-IP handling.

**Request size.** The application refuses JSON bodies above 1 MiB with `413 PAYLOAD_TOO_LARGE` before reading them in full (the largest legitimate body, an avatar, is ≈ 350 KB). Keep a matching limit at the proxy (`client_max_body_size 1m;`, the nginx default) so oversized uploads stop there.

**Request ids and metrics** ([OPERATIONS.md §11](OPERATIONS.md#11-observability)): have the proxy set `X-Request-Id` (nginx `proxy_set_header X-Request-Id $request_id;`) so its access log and the application's logs, audit rows and jobs share one id. Set `METRICS_TOKEN` and let the monitoring system scrape `/api/metrics` on every instance directly; do not route it through the public proxy (it answers 404 there without the token anyway).

**Load balancer in front of several instances** ([OPERATIONS.md §10](OPERATIONS.md#10-several-instances-and-graceful-shutdown)): no sticky sessions are needed; health-check `/api/health/ready` (unauthenticated) and remove a target on 503; do not buffer `/api/v1/properties/*/events` (server-sent events: `proxy_buffering off`, read timeout above 25 s, the heartbeat interval); abort the upstream request when the client disconnects (the nginx and HAProxy default) so closed event streams do not stay open on the instance; and count every proxy that appends to `X-Forwarded-For` in `TRUSTED_PROXY_HOPS`.

## 8. Warnings

- Never deploy with values from the `.env.example` files. Validation rejects `change-me`-style secrets and database passwords, but choose real random values anyway.
- Never set `CLIENT_ORIGINS` to localhost or http in production. Validation stops the server. `APP_URL` is no longer read.
- Keep the two auth secrets distinct and private. Rotating `AUTH_ACCESS_TOKEN_SECRET` signs everyone out within the access TTL. Rotating `AUTH_REFRESH_TOKEN_SECRET` signs everyone out immediately and voids reset links.
- Never run `db:migrate`, `db:reset` or `db:seed` against production.
- Restrict who can run `ops:bootstrap` to the server operator; it needs the production environment and database access.
- Never run the application as the schema owner or a superuser in production. The owner can disable the ledger triggers (OPERATIONS.md §4).
- There is no Docker configuration, and none should be added. PostgreSQL runs natively.
- The first deploy after the server split changes authentication (Bearer access token; the old access and session-marker cookies are gone, the refresh cookie is `__Secure-sm_rt` scoped to `/api/v1/auth`): every user signs in once more. Old cookies expire on their own.
- `NEXT_PUBLIC_API_URL` is baked into the client build. Changing the API URL means rebuilding the client.
- `JOB_WORKER=off` applies to every process that reads it, including `npm run worker` (it then exits without claiming jobs). Do not put it in an environment file the workers share (§10).

## 9. Production deployment runbook

Use this for every release; the first installation follows the same steps plus step 8. Commands run in the repository (release) directory, with the production environment loaded.

1. **Preconditions**
   - The release passed CI (OPERATIONS.md §9) and was tested on staging against a restored copy of production (OPERATIONS.md §3.2).
   - Read the release's migrations (`server/prisma/migrations/*/migration.sql`): note long-running or locking steps, and schedule them off-peak and away from the night audit.
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
   - Layout A: `npm ci` → `NEXT_PUBLIC_API_URL=… npm run build` → `npm prune --omit=dev`.
   - Layout B: copy the artifacts, then `npm ci --omit=dev` (§3).
5. **Prisma client generation.** `postinstall` runs `prisma generate` during `npm ci`. It needs no database access and no credentials, and it must finish without errors. There is no separate step.
6. **Migrations**
   ```bash
   npm run db:deploy
   npm run ops:seed -- --apply --yes --database <name>
   ```
   - `db:deploy` must end with `All migrations have been successfully applied` (or report nothing to apply).
   - If it fails, stop and follow OPERATIONS.md §3.4. Do not start the new release against a half-migrated database.
7. **Start, in this order:** restart the API service(s) (`node dist/index.mjs`; the process exits immediately, with the list of problems, if the environment is invalid), wait for `/api/health/ready` to return 200, then restart the client service(s) (`next start`). Restart workers last.
8. **First installation only.** Create the runtime role (OPERATIONS.md §4), run `npm run ops:bootstrap -- --apply --yes --database <name> …` (§5.2), then sign in and create the first property. Schedule backups and maintenance (OPERATIONS.md §8). Background jobs run inside the API process by default; to run separate workers see OPERATIONS.md §7.
9. **Health and smoke checks**
   - Wait for `/api/health/ready` to return 200 before routing traffic (§6). `/api/health/live` must return 200 throughout.
   - `npm run ops:db-check -- --strict`: no `FAIL` or `WARN` lines (guards enabled, UTC session, no failed migrations, runtime role is not the owner).
   - Sign in. Open the room rack for today's business date. Open one in-house folio. Run one report for the last closed date. Sign out.
10. **Rollback and recovery.** Migrations are never rolled back automatically (OPERATIONS.md §3.2).
    - **The application misbehaves and the schema is unchanged or backward compatible** (expand/contract): redeploy the previous release's artifacts and restart (server first, then client; the client of release N must still work against the API of release N-1 and the reverse during a rolling update, so keep the API additive).
    - **A migration failed or corrupted data:** keep the application stopped and follow OPERATIONS.md §3.4. If data is damaged, restore the step-3 backup into a new database and switch over (OPERATIONS.md §2.4), then redeploy the previous release.
    - **Otherwise,** fix forward with a corrective migration in a new release.
11. **Post-deployment verification**
    - Watch the logs and `/api/health/ready` for the first hour.
    - Confirm the next scheduled backup and maintenance runs succeed.
    - After the next night audit, check that the business date rolled and that `ops:db-check` is still clean.
    - Record the release, the backup file name and any issues.

## 10. Production configuration checklist

Every variable the API server and worker read (`server/config/env.ts`), with the production rule, followed by the client's. **W** = API server instances, **K** = worker processes. Keep the file that holds them (`EnvironmentFile=` in systemd, or the service manager's secret store) readable only by the service account (mode 600). Never print the values; generate secrets on the production side with `openssl rand -base64 48`.

| Variable                                                                                                  | W   | K   | Production value / rule                                                                                                                                                                                                                       | Enforced at start                          |
| --------------------------------------------------------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `NODE_ENV`                                                                                                | ✓   | ✓   | `production`                                                                                                                                                                                                                                  | —                                          |
| `CLIENT_ORIGINS`                                                                                          | ✓   | ✓   | The public `https://` origin(s) of the web app (comma separated, no path). CORS allowlist and `Origin` check of `/auth/refresh` and `/auth/logout`; replaces `APP_URL`                                                                        | https, not localhost                       |
| `PORT`                                                                                                    | ✓   | —   | API listen port, default 4000                                                                                                                                                                                                                 | 1–65535                                    |
| `REDIS_URL`                                                                                               | ✓   | ✓   | Optional. Shares session and permission caches across instances; unset keeps per-process caches (TTL ≤ 10 s). Outage falls back to memory                                                                                                     | redis:// or rediss://                      |
| `SESSION_CACHE_TTL_MS`, `PERMISSION_CACHE_TTL_MS`                                                         | ✓   | ✓   | Optional, default 30000 with Redis, 10000 in memory                                                                                                                                                                                           | 0–300000                                   |
| `DATABASE_URL`                                                                                            | ✓   | ✓   | **Runtime role** (not the schema owner) on the production database. Add `?sslmode=verify-full&sslrootcert=…` when PostgreSQL is on another host                                                                                               | real password                              |
| `MIGRATION_DATABASE_URL`                                                                                  | —   | —   | Schema owner, only where `db:deploy` and `ops:backup` run; never in the web or worker environment                                                                                                                                             | URL format                                 |
| `AUTH_ACCESS_TOKEN_SECRET`                                                                                | ✓   | ✓   | 48 random bytes, base64; the same value on every instance                                                                                                                                                                                     | ≥ 32 characters, random, not a placeholder |
| `AUTH_REFRESH_TOKEN_SECRET`                                                                               | ✓   | ✓   | Different 48 random bytes; the same on every instance. Rotating it signs everyone out                                                                                                                                                         | differs from the access secret             |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                                                                           | ✓   | ✓   | Default 900                                                                                                                                                                                                                                   | 60–3600                                    |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                                                                          | ✓   | ✓   | Default 1209600 (14 days)                                                                                                                                                                                                                     | longer than the access TTL                 |
| `FIELD_ENCRYPTION_KEY`                                                                                    | ✓   | ✓   | 32 random bytes, base64 (`openssl rand -base64 32`). Reserved for encrypted guest fields: set it now and keep it with the secrets, never with the database backups                                                                            | 32 bytes when set                          |
| `TRUSTED_PROXY_HOPS`                                                                                      | ✓   | ✓   | Proxies that append to `X-Forwarded-For` (one TLS load balancer: `1`; CDN + load balancer: `2`). Instances must be reachable only through that chain                                                                                          | must be set                                |
| `METRICS_TOKEN`                                                                                           | ✓   | ✓   | 36+ random bytes: the scraper's bearer token. Unset = `/api/metrics` answers 404                                                                                                                                                              | random when set                            |
| `INSTANCE_ID`                                                                                             | ✓   | ✓   | Unique per process, e.g. `web-1`, `worker-1` (logs and metrics; no secrets)                                                                                                                                                                   | pattern                                    |
| `JOB_WORKER`                                                                                              | ✓   | ✓   | `off` on API instances when separate workers run; leave unset (`inline`) in worker processes and on a single server. **Per process:** a value in a shared environment file also stops the separate workers, so set `off` in the API unit only | enum                                       |
| `JOB_WORKER_CONCURRENCY`, `JOB_LEASE_MS`, `JOB_POLL_INTERVAL_MS`                                          | —   | ✓   | Defaults 1 / 60000 / 5000                                                                                                                                                                                                                     | ranges                                     |
| `RATE_LIMIT_STORE`                                                                                        | ✓   | —   | `postgres` (default). `memory` only with a single instance: the application cannot detect other instances, so this is an operator check                                                                                                       | enum only                                  |
| `REALTIME_ENABLED`                                                                                        | ✓   | —   | `1` (default); `0` makes every screen poll                                                                                                                                                                                                    | enum                                       |
| `REALTIME_DATABASE_URL`                                                                                   | ✓   | —   | Only with PgBouncer in transaction mode: a direct (session) URL for LISTEN                                                                                                                                                                    | required in that mode                      |
| `DATABASE_POOLER`                                                                                         | ✓   | ✓   | `none`, or `pgbouncer-transaction` when `DATABASE_URL` points at PgBouncer (OPERATIONS §6)                                                                                                                                                    | enum                                       |
| `DATABASE_POOL_MAX`                                                                                       | ✓   | ✓   | Web 10, workers 4 in the reference topology (budget in §11)                                                                                                                                                                                   | 1–50                                       |
| `DATABASE_POOL_MIN`, `DATABASE_POOL_IDLE_TIMEOUT_MS`, `DATABASE_POOL_MAX_LIFETIME_S`                      | ✓   | ✓   | Defaults 0 / 120000 / 0                                                                                                                                                                                                                       | ranges                                     |
| `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | ✓   | ✓   | Defaults 5000 / 30000 / 60000                                                                                                                                                                                                                 | ranges                                     |
| `READ_DATABASE_URL`, `READ_DATABASE_POOL_MAX`, `READ_REPLICA_MAX_LAG_MS`                                  | ✓   | —   | Only when a streaming standby is provisioned (OPERATIONS §6); unset otherwise                                                                                                                                                                 | URL format                                 |
| `SEARCH_CONCURRENCY`                                                                                      | ✓   | —   | Default 3                                                                                                                                                                                                                                     | 1–8                                        |
| `REPORT_HEAVY_CONCURRENCY`, `REPORT_HEAVY_WAIT_MS`                                                        | ✓   | —   | Defaults 1 / 30000                                                                                                                                                                                                                            | ranges                                     |
| `SHUTDOWN_DRAIN_MS`, `SHUTDOWN_TIMEOUT_MS`                                                                | ✓   | ✓   | 5000 / 25000; `SHUTDOWN_DRAIN_MS` ≥ health-check interval × unhealthy threshold                                                                                                                                                               | ranges                                     |
| `SLOW_REQUEST_MS`                                                                                         | ✓   | —   | Default 2000                                                                                                                                                                                                                                  | range                                      |
| `SERVER_TIMING`                                                                                           | ✓   | —   | **`0` (the default) in production.** `1` sends per-request timings and the instance id to clients: load tests only                                                                                                                            | enum                                       |
| `OPS_EXPECTED_DATABASE`                                                                                   | —   | —   | Optional alternative to `--database <name>` for operator writes; set it in the shell of the one command, not in a service environment                                                                                                         | —                                          |
| `BOOTSTRAP_*`                                                                                             | —   | —   | Only for the single `ops:bootstrap` run (§5.2); never in a service environment                                                                                                                                                                | —                                          |
| `SEED_DEMO`, `SEED_DEMO_PASSWORD`                                                                         | —   | —   | Never in production (the demo seed refuses `NODE_ENV=production`)                                                                                                                                                                             | refused                                    |

**Client variables** (`client/.env.local` or the build environment; read at **build time**):

| Variable              | Rule                                                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | The public API base URL including `/api/v1`, e.g. `https://pms.example.com/api/v1`. Default `http://localhost:4000/api/v1`. Never a secret. Its origin is allowed by the client's CSP `connect-src` and must appear in the server's `CLIENT_ORIGINS` when it differs from the client's origin. |

Offline mode needs no server variable: the read-only offline copy lives in the browser (OFFLINE_ARCHITECTURE.md).

## 11. Reference production topology

```
Internet ──▶ DNS pms.<hotel-domain> ──▶ TLS load balancer (nginx / HAProxy / cloud LB; 80 → 301 https)
                                         │  X-Forwarded-For (append), X-Forwarded-Proto, X-Request-Id
                          /api/*  ───────┴───────  /  (everything else)
                    api-1 :4000 (JOB_WORKER=off)   api-2 :4000        client-1 :3000   client-2 :3000   ← private network only
                          └──────────────┬──────────────┘
                     PostgreSQL 17/18 (runtime role) ◀── worker-1, worker-2 (npm run worker, metrics :9101)
                     Redis (optional) ◀── api-1, api-2, workers (session/permission caches)
                                         ▲
                     backups: ops:backup (schema owner) → gpg → off-host storage
Monitoring: Prometheus scrapes /api/metrics on each API instance and /metrics on each worker directly (bearer token)
```

Routing both applications under one host (`/api/` to the API, everything else to the client) makes the browser see one origin: set `NEXT_PUBLIC_API_URL=https://pms.<hotel-domain>/api/v1` and `CLIENT_ORIGINS=https://pms.<hotel-domain>`. With separate hosts (`pms.` and `api.` under the same registrable domain) also list the client origin in `CLIENT_ORIGINS`; the refresh cookie is host-only on the API host and `SameSite=Strict` still sends it between sibling subdomains.

**Connection budget** (OPERATIONS §6; `ops:db-check` prints it): 2 API instances × (10 + 1 LISTEN) + 2 workers × (4 + 1) + one API instance of rolling-update surge (11) + 10 for migrations, backups, monitoring and administrators = 53, inside `max_connections` 100 − 3 reserved. Give the runtime role a `CONNECTION LIMIT` (for example 60) so a runaway pool cannot exhaust the server.

**Database roles.** The schema owner and the runtime role are separate (OPERATIONS §4). Only role creation needs a superuser. After that, the owner runs the migrations and the grants in `scripts/db/runtime-grants.sql`, except its final `ALTER ROLE … SET` lines: those need `CREATEROLE` and belong in the superuser step. When PostgreSQL is on another host, enable `ssl = on`, allow only `hostssl … scram-sha-256` in `pg_hba.conf` for both roles, and use `sslmode=verify-full` in the URLs.

**nginx.** Open-source nginx has passive health checks only. To drain an instance, remove it from `upstream` and reload before stopping it, or use HAProxy or a cloud load balancer with active readiness checks. This example is for the recommended one-host layout (`pms.example-hotel.com` serves the client and routes `/api/` to Express). `proxy_pass` has no URI part on purpose, so `/api/v1/...` reaches Express unchanged. `http2 on;` needs nginx 1.25.1 or newer (on older versions write `listen 443 ssl http2;`).

> Reviewed line by line against the code (paths, headers, timeouts, body limit) but **not yet rehearsed on a server**: run `nginx -t` on the proxy host before use.

```nginx
upstream serene_api {
    server 10.0.0.11:4000 max_fails=2 fail_timeout=10s;
    server 10.0.0.12:4000 max_fails=2 fail_timeout=10s;
    keepalive 32;
}
upstream serene_client {
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
    server_tokens off;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # TRUSTED_PROXY_HOPS=1
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-Id $request_id;
    proxy_connect_timeout 5s;
    proxy_send_timeout 75s;
    proxy_read_timeout 75s;
    proxy_next_upstream error timeout;        # nginx never retries non-idempotent requests by default
    # Security headers: the client sets HSTS, the nonce CSP, X-Frame-Options, nosniff, COOP, Referrer/Permissions-Policy; the API sets helmet's set.

    # server-sent events; a regex location wins over the /api/ prefix below (no URI after proxy_pass in a regex location)
    location ~ ^/api/v1/properties/[^/]+/events$ {
        proxy_pass http://serene_api;
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 120s;              # longer than the 25 s heartbeat
        proxy_next_upstream off;              # never replay a stream on another instance
    }
    location = /api/metrics { return 404; }   # scrape instances directly, never through the public proxy
    location /api/ { proxy_pass http://serene_api; }
    location / { proxy_pass http://serene_client; }
}
```

With the two-host layout (`pms.` for the client, `api.` for Express, same registrable domain) add a second `server` block for `api.` with its own certificate and the same `proxy_*` lines, whose `location /` proxies to `serene_api` (keep the events and `/api/metrics` rules), and drop `/api/` from the `pms.` block. Then `NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1` and `CLIENT_ORIGINS=https://pms.<domain>`; the client's CSP `connect-src` follows `NEXT_PUBLIC_API_URL`.

**HAProxy** (active readiness checks; it drains an instance automatically when it answers 503 `draining`). A complete minimal file for the one-host layout; the TLS certificate is a combined PEM (fullchain + key):

```haproxy
global
    log /dev/log local0
    ssl-default-bind-options ssl-min-ver TLSv1.2

defaults
    mode http
    log global
    option httplog
    option redispatch
    retries 2
    timeout connect 5s
    timeout client  75s
    timeout server  75s                       # the event stream gets a longer one in its backend
    timeout http-request 60s

frontend fe_https
    bind :80
    bind :443 ssl crt /etc/haproxy/certs/pms.example-hotel.com.pem alpn h2,http/1.1
    http-request redirect scheme https code 301 unless { ssl_fc }
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Request-Id %[uuid()]
    option forwardfor                          # appends the peer to X-Forwarded-For; TRUSTED_PROXY_HOPS=1
    acl is_metrics path -i /api/metrics
    http-request deny deny_status 404 if is_metrics
    acl is_api path_beg /api/
    use_backend serene_api if is_api
    default_backend serene_client

backend serene_api
    balance leastconn
    option httpchk GET /api/health/ready
    http-check expect status 200
    default-server inter 1s fall 2 rise 2
    timeout server 120s                       # longer than the 25 s SSE heartbeat
    server api1 10.0.0.11:4000 check
    server api2 10.0.0.12:4000 check

backend serene_client
    balance leastconn
    option httpchk GET /
    http-check expect rstatus (2|3)[0-9][0-9] # the client has no health route; / may redirect
    default-server inter 2s fall 2 rise 2
    server client1 10.0.0.11:3000 check
    server client2 10.0.0.12:3000 check
```

> Reviewed against the code but **not yet rehearsed on a server**: run `haproxy -c -f /etc/haproxy/haproxy.cfg` on the proxy host before use. The event stream is plain HTTP, so `timeout server` (not `timeout tunnel`) is the setting that matters; the 25 s heartbeat keeps the connection active.

Validate the real file with `nginx -t` or `haproxy -c -f …` on the proxy host: these examples were not run through either tool (the rehearsal used a stand-in proxy, §12).

**systemd units** (Linux; on Windows use NSSM with `AppStopMethodConsole` and the same timeouts). `%i` is the instance name after the `@`: the listen port for API and client units, the metrics port for worker units; `%H` is the host name.

> Reviewed against the code but **not yet rehearsed on a server**: run `systemd-analyze verify /etc/systemd/system/serene-*@.service` after installing them.

```ini
# /etc/systemd/system/serene-api@.service   (instance name = port, e.g. serene-api@4000)
[Unit]
Description=SERENE MANAGEMENT API %i
Wants=network-online.target
After=network-online.target

[Service]
User=serene
Group=serene
WorkingDirectory=/srv/serene/current/server
EnvironmentFile=/etc/serene/serene.env
Environment=NODE_ENV=production
Environment=INSTANCE_ID=api-%H-%i
Environment=JOB_WORKER=off
Environment=PORT=%i
ExecStart=/usr/bin/node /srv/serene/current/server/dist/index.mjs
KillSignal=SIGTERM
# SHUTDOWN_TIMEOUT_MS (25 s) + 5 s hard exit + margin; raise it with SHUTDOWN_TIMEOUT_MS
TimeoutStopSec=35
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target

# /etc/systemd/system/serene-client@.service   (instance name = port, e.g. serene-client@3000)
[Unit]
Description=SERENE MANAGEMENT client %i
Wants=network-online.target
After=network-online.target

[Service]
User=serene
Group=serene
WorkingDirectory=/srv/serene/current/client
Environment=NODE_ENV=production
# keepAliveTimeout above nginx's 60 s upstream idle time, so nginx never reuses a connection Next.js just closed (its default is 5 s)
ExecStart=/usr/bin/node /srv/serene/current/node_modules/next/dist/bin/next start -p %i -H 0.0.0.0 --keepAliveTimeout 70000
KillSignal=SIGTERM
TimeoutStopSec=30
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target

# /etc/systemd/system/serene-worker@.service   (instance name = metrics port, e.g. serene-worker@9101)
[Unit]
Description=SERENE MANAGEMENT worker %i
Wants=network-online.target
After=network-online.target

[Service]
User=serene
Group=serene
WorkingDirectory=/srv/serene/current/server
EnvironmentFile=/etc/serene/serene.env
Environment=NODE_ENV=production
Environment=INSTANCE_ID=worker-%H-%i
Environment=DATABASE_POOL_MAX=4
# The worker runs unless JOB_WORKER is "off" in ITS environment; "inline" (the default) means "run jobs".
Environment=JOB_WORKER=inline
ExecStart=/usr/bin/node /srv/serene/current/server/dist/workers/worker.mjs --metrics-port %i
KillSignal=SIGTERM
# The worker waits up to 60 s for running jobs; systemd kills it after this (OPERATIONS §7)
TimeoutStopSec=90
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Rules the units depend on:

- **`JOB_WORKER` is per process, and `off` stops the separate worker too** (`server/workers/worker.ts` logs `disabled` and exits 0; `Restart=on-failure` does not restart a clean exit). The API unit sets `off`, the worker unit sets `inline`. Systemd lets `EnvironmentFile=` values override `Environment=`, so the shared `/etc/serene/serene.env` must not set `JOB_WORKER`, `PORT`, `INSTANCE_ID` or `DATABASE_POOL_MAX` (each unit sets its own). A stray `server/.env` file cannot override them, because real environment variables win.
- **`METRICS_TOKEN` must be in the shared file** when the worker unit uses `--metrics-port`: without it the worker refuses to start (exit 1) and systemd restarts it in a loop. Drop `--metrics-port %i` if worker metrics are not scraped.
- The server reads the process environment first, then `server/.env`, then the repository-root `.env`; production should use only the `EnvironmentFile`.
- The shared `/etc/serene/serene.env` is for the API and the worker. The client unit needs no server secrets; its only build-time setting is `NEXT_PUBLIC_API_URL`. The `serene` user must be able to write to `client/.next/cache` if the client uses it.

`/srv/serene/current` is a symlink to `/srv/serene/releases/<version>`: a deploy or a rollback switches the link and restarts the units one at a time (OPERATIONS §12.2).

**Firewall.** Only the load balancer reaches the API and client ports, only the monitoring host reaches the metrics ports, and only application hosts, the backup host and administrators reach PostgreSQL (5432).

**Domain and TLS checklist (before go-live).**

- DNS `A`/`AAAA` records for the public name point at the load balancer; keep the TTL low during the first week.
- A publicly trusted certificate for exactly that name (ACME/Let's Encrypt or the hotel's CA), with automatic renewal and an expiry alert at 14 days.
- `http://` answers 301 to `https://`, and `CLIENT_ORIGINS` lists the client's exact `https://` origin (scheme, host, port).
- After the first sign-in the browser holds one cookie, `__Secure-sm_rt` (refresh): `Secure; HttpOnly; SameSite=Strict; Path=/api/v1/auth`. The access token is only in page memory.
- There are no OAuth or SSO callbacks: sign-in redirects stay on the client origin (`/login?next=…`).
- The client already sends `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Consider HSTS preload only after the name has served HTTPS correctly for weeks.

## 12. Release rehearsal: v1.0.0-rc1 (2026-10-03)

> **Historical.** This rehearsal ran the single Next.js application, before the server split (2026-11-12). Commands, ports, cookie names and `APP_URL` below describe that release. The split topology (§11) has not been rehearsed on a real host; repeat the relevant checks (HTTPS and headers, cookies, smoke test, instance and worker failure, rollback, restore) before go-live.

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
