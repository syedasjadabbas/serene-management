# Deployment

How to install, configure, start and verify SERENE MANAGEMENT on a server. The target is a single Node.js process behind a reverse proxy (for example nginx) with a **native PostgreSQL** installation. **Docker is not used.** There is no Redis, no background worker and no SSE. Everything runs in the one Next.js process and the database.

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

Messages never contain the values. `next build` only applies the basic format rules, so the build host does not need production secrets. Development and test keep convenient defaults: `APP_URL` falls back to `http://localhost:3000` and `TRUSTED_PROXY_HOPS` to `0`.

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

On the build host run `npm ci` and `npm run build`. Then copy these to the server: `package.json`, `package-lock.json`, `prisma.config.ts`, `next.config.ts`, `prisma/`, `.next/` (without `.next/cache` and `.next/dev`), `dist/ops/` and `public/` (if present). On the server run:

```bash
npm ci --omit=dev
npm run db:deploy
npm run ops:seed
npm start
```

What each step does:

- **`npm ci --omit=dev`** installs only runtime dependencies. `postinstall` generates the Prisma client and needs no database credentials. The `prisma` CLI is a runtime dependency on purpose, because it provides client generation and `migrate deploy`. `typescript` still appears in `node_modules` because it is a peer dependency of Prisma, not because of the application.
- **`npm run build`** runs `next build` and then `build:ops`, which compiles `scripts/ops/*.ts` to `dist/ops/*.mjs` so the operational commands run on plain `node`, without tsx.
- **`npm start`** runs `next start` on port 3000 (`-p` changes it). Put the reverse proxy in front of it.

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

| Endpoint            | Checks                      | Success                           | Failure                        | Use for                                  |
| ------------------- | --------------------------- | --------------------------------- | ------------------------------ | ---------------------------------------- |
| `/api/health/live`  | The process answers. No DB. | 200 `{"data":{"status":"ok"}}`    | No response / 5xx              | Liveness: restart the process if failing |
| `/api/health/ready` | `SELECT 1`, 2 s timeout     | 200 `{"data":{"status":"ready"}}` | 503 `{"status":"unavailable"}` | Readiness: route traffic only when 200   |
| `/api/health`       | Same as `/ready`            | Same as `/ready`                  | Same as `/ready`               | Kept for existing monitors (alias)       |

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
   - The release passed CI (OPERATIONS.md §8) and was tested on staging against a restored copy of production (OPERATIONS.md §3.2).
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
8. **First installation only.** Create the runtime role (OPERATIONS.md §4), run `npm run ops:bootstrap -- --confirm …` (§5.2), then sign in and create the first property. Schedule backups and maintenance (OPERATIONS.md §7).
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
