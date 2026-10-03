# Operations

Running SERENE MANAGEMENT in production after it is deployed: backups and recovery, migrations, database roles, data retention, connection settings, scheduling and CI. Installation and the release runbook are in [DEPLOYMENT.md](DEPLOYMENT.md). Everything here uses native PostgreSQL and the commands in this repository. There is no Docker and no Redis; background jobs run inside the application or in separate worker processes (§7), with PostgreSQL as the queue. Step-by-step procedures for deploy, rollback, restart, drain, backup, restore, night audit recovery and incidents are in §12.

Related decisions: [ARCHITECTURE.md](ARCHITECTURE.md) D50 (retention), D51 (TRUNCATE guards), D52 (pool and timeouts), D53 (database roles).

## 1. Recovery objectives

These are **operational targets and assumptions**, not guarantees. They hold only if the backups in §2 actually run, are copied off the host and are restore-tested.

| Objective                   | Target with nightly `pg_dump` only             | Target with WAL archiving (§2.5)     |
| --------------------------- | ---------------------------------------------- | ------------------------------------ |
| RPO (data that may be lost) | Up to 24 hours: everything since the last dump | Minutes: up to the last archived WAL |
| RTO (time to serve again)   | About 4 hours for a database of a few GB       | About 4 hours plus WAL replay time   |
| Restore drill               | Quarterly, and after every major upgrade       | Quarterly, including a point in time |

Assumptions:

- The RTO covers provisioning PostgreSQL on a replacement host, restoring (§2.4), deploying the same release (DEPLOYMENT.md) and running the smoke checks.
- Measure the real restore time in each drill (§2.3) and update the RTO from that measurement.
- A hotel that cannot re-enter up to a day of postings, payments and check-ins by hand must add WAL archiving.

## 2. Backup and recovery

### 2.1 Strategy

- **Nightly logical backup** of the application database with `pg_dump -Fc` (custom format: compressed, selective restore), via `npm run ops:backup -- create`.
- **Checksums.** Each backup gets a `.sha256` file next to it. `verify` checks the checksum and that `pg_restore` can read the archive.
- **Keep copies off the host.** A backup on the database server is lost with the server. Copy both files to another machine or site every night (`rsync`/`scp` to a backup host, or object storage with versioning and deletion protection).
- **Encrypt backup storage.** Backups contain guest personal data, audit trails and password hashes. Encrypt each file before it leaves the host with a public key whose private half is kept away from the servers and the backups (§2.6: `gpg`, rehearsed for v1.0.0-rc1), and store the copies on encrypted, access-limited storage.
- **Retention.** Keep 14 daily, 8 weekly and 12 monthly backups; prune older copies on the backup host. Fiscal or legal rules may require keeping month-end or year-end backups longer.
- **Global objects.** Roles and passwords are not in `pg_dump`. Keep the role setup reproducible (`scripts/db/runtime-role.sql`, §4), or add `pg_dumpall --globals-only --no-role-passwords` to the backup job.
- **Pre-release backup.** Take an extra backup before every release that contains migrations (DEPLOYMENT.md §9).

### 2.2 Commands

The commands need the PostgreSQL client tools, `pg_dump` and `pg_restore`, in the same major version as the server or newer. They look for them in `--pg-bin DIR` or `PG_BIN` first, then on `PATH`, then (on Windows) in `C:\Program Files\PostgreSQL\<version>\bin`.

They connect with `MIGRATION_DATABASE_URL` (the schema owner) when it is set, otherwise with `DATABASE_URL`. The password is passed to the tools through the environment, never on their command line, and is never printed.

```bash
npm run ops:backup -- create --out-dir /var/backups/serene
npm run ops:backup -- verify --file /var/backups/serene/serene_management_20261102T020000Z.dump
npm run ops:backup -- list --dir /var/backups/serene
npm run ops:backup -- restore --file <file.dump> --target-db serene_restore_drill --confirm-target serene_restore_drill --create
```

Commands:

- **`create`** writes `<database>_<UTC time>.dump` through a temporary `.partial` file, so a half-written dump never carries the final name. It then writes a checksum file with mode 600.
- **`verify`**:
  - checks the SHA-256;
  - lists the archive with `pg_restore --list`;
  - confirms that `_prisma_migrations`, `audit_logs` and `organizations` are present.
- **`list`** shows each backup's size and date, and whether its checksum file exists.
- **`restore`** is never destructive:
  - it restores only into a **new** database (`--create`) or an **empty** one;
  - the target name must be typed twice (`--target-db` and `--confirm-target`);
  - it refuses the database the application uses (`DATABASE_URL` or `MIGRATION_DATABASE_URL`);
  - it verifies the checksum first;
  - it restores in one transaction with `--no-owner --no-privileges`, so a failed restore leaves the target empty;
  - it never drops or overwrites anything.
- **Exit codes:**
  - 0: success
  - 1: failure (for example a checksum mismatch or a tool error)
  - 2: invalid arguments or a refused request

### 2.3 Restore drill (quarterly)

Run the drill on a staging host, or on the production server outside business hours. Use a throwaway database name.

1. Pick last night's backup (or a copied off-site one; decrypt it first on the restore host, §2.6) and verify it:
   ```bash
   npm run ops:backup -- verify --file <file.dump>
   ```
2. Restore it into a temporary database:
   ```bash
   npm run ops:backup -- restore --file <file.dump> --target-db serene_restore_drill --confirm-target serene_restore_drill --create
   ```
   `--create` needs the connecting role to have `CREATEDB`. Otherwise a DBA runs `createdb -O <owner> serene_restore_drill` first and you drop `--create`.
3. Check the schema against the release:
   ```bash
   MIGRATION_DATABASE_URL=<url of serene_restore_drill> node node_modules/prisma/build/index.js migrate status
   ```
   Expect `Database schema is up to date!`. A backup from an older release reports pending migrations, which is correct, because `db:deploy` would apply them.
4. Check the database posture and the data:
   ```bash
   DATABASE_URL=<url of serene_restore_drill> npm run ops:db-check
   ```
   Expect `OK` for the guard triggers, the UTC session and the migrations. Then compare row counts of key tables with production (`organizations`, `reservations`, `folio_items`, `audit_logs`) and check that the newest `audit_logs.created_at` matches the backup time.
5. Prove the application works on it. Start a staging instance (DEPLOYMENT.md §3) with `DATABASE_URL` pointing at the restored database, then:
   - check that `/api/health/ready` returns 200;
   - sign in;
   - open the room rack and a folio;
   - run a report for the last closed business date.
6. Record the result: the backup file and checksum, the restore duration (this measures the RTO), and any problems found.
7. Clean up. Drop the database with `dropdb serene_restore_drill` (as its owner or a DBA), and delete the staging instance's environment if you made one.

### 2.4 Disaster recovery and switch-over

To replace a lost or corrupted production database:

1. Stop the application (or take it out of the load balancer) so nothing writes.
2. Keep the damaged database: rename it instead of dropping it (`ALTER DATABASE serene_management RENAME TO serene_management_damaged_<date>`, run while nothing is connected).
3. Restore the chosen backup into a new database (§2.3 step 2).
4. Rename the restored database to the production name, or point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at it.
5. Re-apply the runtime role grants (`scripts/db/runtime-role.sql`, §4). A restore runs with `--no-privileges`, so no grants come with it.
6. Run `npm run db:deploy` if the running release is newer than the backup, then `npm run ops:db-check -- --strict`.
7. Start the application, wait for `/api/health/ready`, and run the smoke checks (DEPLOYMENT.md §9).
8. Tell the hotel which window of data was lost: from the backup time to the incident time. Postings, payments and check-ins from that window must be re-entered from paper or PSP records.

### 2.5 Point-in-time recovery (when 24 hours of loss is too much)

`pg_dump` is a logical snapshot and cannot replay to a moment. For an RPO of minutes, add physical backups with continuous WAL archiving on the PostgreSQL server:

- `wal_level = replica`, `archive_mode = on`, and an `archive_command` that copies each WAL segment off the host.
- A weekly `pg_basebackup` (or a tool that manages both, such as pgBackRest or WAL-G, installed natively).
- Recovery restores the base backup and replays WAL up to `recovery_target_time`.

This is server administration outside the application; test it in the same quarterly drill. Keep the nightly `pg_dump` alongside it, because a logical dump is the simplest way to restore into a different server version or host.

### 2.6 Encryption, off-host copies and retention

`ops:backup` writes a plain (compressed) `pg_dump` and its checksum. Encrypt it before it leaves the host, with **public-key** encryption, so the server that makes backups cannot read them:

1. **Once, on an administrator's workstation (not a server):** create the backup key and keep its private half offline (password manager, hardware token or a sealed copy with the hotel):
   ```bash
   gpg --quick-gen-key "SERENE backup key <backup@your-hotel.com>" rsa3072 encrypt 2y
   gpg --armor --export backup@your-hotel.com > serene-backup-public.asc
   ```
   Import only `serene-backup-public.asc` on the backup host (`gpg --import`). Its keyring must hold no secret key.
2. **Nightly, on the backup host** (cron, §8), after `create` and `verify`:
   ```bash
   f=$(ls -1t /var/backups/serene/*.dump | head -n 1)
   gpg --batch --yes --trust-model always --recipient backup@your-hotel.com --output "$f.gpg" --encrypt "$f"
   sha256sum "$f.gpg" > "$f.gpg.sha256"
   rsync -a "$f.gpg" "$f.gpg.sha256" "$f.sha256" backup@offsite:/srv/serene-backups/   # or object storage with versioning + deletion protection
   ssh backup@offsite "cd /srv/serene-backups && sha256sum -c $(basename "$f").gpg.sha256" && rm -f "$f"
   ```
   Copy the dump's own `.sha256` too: `ops:backup restore` checks it after decryption. Remove the plaintext dump once the encrypted copy is confirmed off the host.
3. **Retention** on the off-host store: keep 14 daily, 8 weekly (Sunday) and 12 monthly (first of the month) backups, for example `find /srv/serene-backups -name '*.dump.gpg' -mtime +14 …` with the weekly and monthly ones moved to their own folders before pruning. Alert when no new `.gpg` file arrived in 26 hours.
4. **Restore host:** copy the three files, check `sha256sum -c <file>.gpg.sha256`, decrypt with the private key (`gpg --output <file>.dump --decrypt <file>.dump.gpg`), then follow §2.3 from step 1. Delete the decrypted file after the restore.

Rehearsed for v1.0.0-rc1 (DEPLOYMENT.md §12): a 610 KiB dump in 1 s, encrypted (no plaintext `PGDMP` header left), copied and checked off the host, decrypted and restored into a new database in 3 s, with identical row counts and a ready instance 0.5 s later. Scale the RTO in §1 from your own drill, not from this small database.

## 3. Migrations

### 3.1 How Prisma applies migrations (verified with Prisma 7.10 and PostgreSQL 18)

- `npm run db:deploy` (`prisma migrate deploy`) applies pending migration files in name order and takes an advisory lock, so two deploys cannot run at once.
- **A migration file is not one transaction.** Prisma sends its statements one by one. If statement 3 fails, statements 1–2 stay applied, and the migration is recorded as failed (`P3018`); no later migration runs until it is resolved.
- For all-or-nothing behaviour, a multi-statement migration must contain its own `BEGIN;` … `COMMIT;`. Tested: with them, a failure rolls the whole file back.
- Migrations connect with `MIGRATION_DATABASE_URL` (the owner, §4), or with `DATABASE_URL` when that is unset. They are not affected by the application's statement timeout (§6).
- Some older migration files carry comments that say "inside this migration's transaction". They were applied successfully and must not be edited. New migrations follow the rules below.

### 3.2 Policy

1. **Never edit an applied migration.** Its checksum is recorded, and databases that already ran it would diverge.
2. **No automatic rollback.** Prisma cannot reverse migrations, and they are not written with down scripts. The recovery path is **forward-fix**: write a new corrective migration.
3. **Back up before every release that contains migrations** (§2), and know which backup you would restore.
4. **Test on a production-like database first.** Restore a recent production backup on staging (§2.3), run `db:deploy` there, time it, and run the smoke checks.
5. **Destructive changes use expand → migrate → contract** across releases:
   - add the new column or table;
   - deploy code that writes both and reads the new one;
   - backfill;
   - drop the old one in a later release, once no running code uses it.
   - Never rename or drop in the same release that stops using the object.

### 3.3 Safety checklist for a new migration

- [ ] The generated SQL has been reviewed. Hand-written rules also go into DATABASE_DESIGN.md §5.
- [ ] Multi-statement DDL/DML is wrapped in `BEGIN;` … `COMMIT;`, unless it contains `CONCURRENTLY` (see below).
- [ ] It starts with `SET lock_timeout = '5s';` when it alters busy tables. A migration then fails fast instead of queueing behind long transactions and blocking every request behind it; retry it off-peak.
- [ ] **Indexes on large tables** (`folio_items`, `audit_logs`, `reservation_room_nights`, `room_status_history`, `outbox_events`) use `CREATE INDEX CONCURRENTLY`:
  - put it in a migration file of its own, without `BEGIN`/`COMMIT`, because `CONCURRENTLY` cannot run inside a transaction block;
  - a failed concurrent build leaves an `INVALID` index. Drop it with `DROP INDEX CONCURRENTLY IF EXISTS …`, then `prisma migrate resolve --rolled-back <migration>`, and deploy again.
- [ ] **No large backfill in a migration.** Update big tables in batches (for example 5 000 rows per statement, committed separately) from a one-off operator script, between the expand and contract releases. Migrations stay short.
- [ ] Timestamps: `timestamptz` columns, with values written in UTC. SQL that converts times uses explicit `AT TIME ZONE`, never the session zone (DATABASE_DESIGN.md "Time zones").
- [ ] Money stays `numeric(19,4)`. Business dates stay `date`.
- [ ] Ledgers stay append-only. A new append-only table gets the row guard **and** a `BEFORE TRUNCATE` guard, and is added to `scripts/ops/db-guards.ts`.
- [ ] `npm run test` passes. `prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` reports no difference on a migrated database.

### 3.3.1 Index migrations of Phase 10 (batches 4+5)

The nine `20261110090000_idx_*` … `20261110090800_idx_*` migrations each contain one `CREATE INDEX CONCURRENTLY`. Writes continue while they build, and they run in a normal `npm run db:deploy`. On a large database, expect the build to take minutes per index, and schedule it off-peak and away from the night audit.

If one fails, `migrate status` names it. Then:

1. Drop the leftover INVALID index (`DROP INDEX CONCURRENTLY IF EXISTS "<name>"`).
2. Run `prisma migrate resolve --rolled-back <migration>`.
3. Deploy again.

The recovery commands are also in each migration file's header.

### 3.4 A migration failed in production

1. Stop there; do not run `db:deploy` again blindly. `npm run ops:db-check` reports "failed or unfinished migrations"; `migrate status` names the migration.
2. Read the error and find which statements were applied: look at the objects in the database, not only the file.
3. Either:
   - complete the remaining statements by hand, then run `prisma migrate resolve --applied <name>`; or
   - undo the applied ones by hand, then run `prisma migrate resolve --rolled-back <name>`, fix the cause, and deploy again.
4. If the data is damaged, restore the pre-release backup (§2.4) and redeploy the previous release.

## 4. Database roles

| Role            | Example      | Owns                            | Used by                                               | May                                                                                                              |
| --------------- | ------------ | ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Schema owner    | `serene`     | the database, schema and tables | `db:deploy`, backups (`MIGRATION_DATABASE_URL`)       | DDL; could disable triggers, so it is not used by the running application                                        |
| Runtime role    | `serene_app` | nothing                         | the application and `ops:*` commands (`DATABASE_URL`) | `SELECT`/`INSERT`/`UPDATE`/`DELETE` only; no `TRUNCATE`, no DDL, no trigger changes; migration history read-only |
| DBA / superuser | `postgres`   | —                               | role creation, emergencies                            | everything; never used by the application                                                                        |

Why: the append-only and immutability triggers stop the application from changing ledger rows. But a role that **owns** a table can `ALTER TABLE … DISABLE TRIGGER`, `DROP TRIGGER` or drop the table. Separating the runtime role means a compromised application process cannot remove those protections. `TRUNCATE` is additionally blocked by statement-level triggers on the guarded tables (D51), even for the owner.

**Set up or convert an installation** (after `npm run db:deploy`):

```bash
SERENE_RUNTIME_PASSWORD='<strong password>' psql -h HOST -U postgres -d postgres -X \
  -v owner_role=serene -v runtime_role=serene_app -v app_db=serene_management \
  -f scripts/db/runtime-role.sql
```

On Windows, run it from PowerShell with `$env:SERENE_RUNTIME_PASSWORD = '…'` set first, and use the `psql.exe` from the PostgreSQL `bin` folder.

What the script does:

- It creates or updates the role. The password comes from the environment and must be at least 16 characters.
- It grants data privileges on existing tables, and default privileges so that tables created by later migrations are granted automatically.
- It sets role defaults for time zone and timeouts (§6).
- It is idempotent: re-run it after a restore or after rotating the password.

Then:

1. Set `DATABASE_URL` to the runtime role and `MIGRATION_DATABASE_URL` to the owner.
2. Restart the application.
3. Run `npm run ops:db-check -- --strict`. It must report no `WARN` lines.

Development keeps the single owner role (`npm run db:setup`), so `ops:db-check` shows two `WARN` lines there. That is expected. CI runs the full split on every push (§8).

**Limits:** the owner and superusers can still drop triggers. Protect those credentials: they live only where migrations and backups run, not in the application's environment. Audit integrity against a DBA is an organizational control, not a database one.

## 5. Data retention and maintenance

`npm run ops:maintenance` prunes transient operational data. Ledgers, audit logs, reservations, folios and every other business record are **never** pruned.

| Data                        | Removed when                                 | Why this window                                                                                                                                                           |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_sessions`             | expired or revoked more than **30 days** ago | Only live sessions are listed or usable. Logins stay in the audit log.                                                                                                    |
| `password_reset_tokens`     | expired or used more than **7 days** ago     | Links live 30 minutes and are single-use.                                                                                                                                 |
| `idempotency_keys`          | expired more than **7 days** ago             | The replay window is 24 hours; expired keys are already reusable.                                                                                                         |
| `outbox_events` PUBLISHED   | published more than **30 days** ago          | Delivered; kept a month for troubleshooting.                                                                                                                              |
| `outbox_events` FAILED      | occurred more than **90 days** ago           | Kept longer for investigation.                                                                                                                                            |
| `rate_limit_windows`        | window ended more than **1 day** ago         | Windows last at most an hour; the table is UNLOGGED and restarts empty after a crash anyway (D59).                                                                        |
| `background_jobs` finished  | finished more than **30 days** ago           | What a job did is on record elsewhere (the night audit run, the audit log). QUEUED and RUNNING jobs are never pruned.                                                     |
| `outbox_events` **PENDING** | **never**                                    | No publisher exists yet (D40). These are the only record of events a future integration must deliver. The count is reported on every run so a growing backlog is visible. |

How it behaves:

- Each run deletes in batches (default 1 000 rows, `--batch-size 10–10000`).
- Every batch is its own short statement with `FOR UPDATE SKIP LOCKED`: no long transaction, no waiting on rows a request is using.
- It is safe to run while the application serves traffic, and safe to repeat; a second run finds nothing.
- `--dry-run` counts without deleting.
- The output is counts only:

```
Retention maintenance (batches of 1000):
  authSessions         12 deleted (older than 30 days)
  passwordResetTokens  0 deleted (older than 7 days)
  idempotencyKeys      340 deleted (older than 7 days)
  outboxPublished      0 deleted (older than 30 days)
  outboxFailed         0 deleted (older than 90 days)
  rateLimitWindows     2310 deleted (older than 1 days)
  backgroundJobs       14 deleted (older than 30 days)
  outbox PENDING       5120 retained (never pruned)
```

The durations are defined in `modules/retention/retention.policy.ts`; change them there and in this table together.

## 6. Connection pool and timeouts

The application uses one connection pool per process (`lib/db/pool-config.ts`). Every setting is explicit:

| Variable                                  | Default | Range                       | Meaning                                                                                          |
| ----------------------------------------- | ------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_POOL_MAX`                       | 10      | 1–50                        | Connections per application process (several instances: budget ÷ instances, SCALABILITY §32)     |
| `DATABASE_POOL_MIN`                       | 0       | 0–max                       | Idle connections kept open at least                                                              |
| `DATABASE_POOL_IDLE_TIMEOUT_MS`           | 120000  | 1000–3600000                | An idle connection above the minimum is closed after this long (30 s churned under live updates) |
| `DATABASE_POOL_MAX_LIFETIME_S`            | 0       | 0–86400                     | Replace pooled connections after this long (0 never; use hours: recycling costs)                 |
| `DATABASE_POOLER`                         | none    | none, pgbouncer-transaction | What DATABASE_URL points at; see "Connection topology" below                                     |
| `DATABASE_CONNECT_TIMEOUT_MS`             | 5000    | 500–60000                   | Wait for a new connection before failing the request                                             |
| `DATABASE_STATEMENT_TIMEOUT_MS`           | 30000   | 1000–600000                 | Any single statement is cancelled after this (`57014`)                                           |
| `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | 60000   | 1000–3600000                | A transaction left idle (a bug) is ended so it cannot hold row locks                             |
| `SEARCH_CONCURRENCY`                      | 3       | 1–8                         | Per-type queries one global search runs at once (connections it may hold; SCALABILITY §28)       |
| `REALTIME_ENABLED`                        | 1       | 0/1                         | Live-update streams (SCALABILITY §31); 0 = every screen polls as before                          |
| `REALTIME_DATABASE_URL`                   | —       | URL                         | Session connection for the one LISTEN per instance; set when DATABASE_URL is transaction-pooled  |
| `JOB_WORKER`                              | inline  | inline, off                 | Run a background job worker in this process (§7); off = leave jobs to `npm run worker`           |
| `JOB_WORKER_CONCURRENCY`                  | 1       | 1–8                         | Jobs one process runs at once (each holds pool connections while it works)                       |
| `JOB_POLL_INTERVAL_MS`                    | 5000    | 500–60000                   | Idle workers look for due jobs this often (inserts also wake them through LISTEN)                |
| `JOB_LEASE_MS`                            | 60000   | 10000–600000                | A claimed job's lease, renewed every third; a dead worker's job is re-claimed after it expires   |
| `REPORT_HEAVY_CONCURRENCY`                | 1       | 1–16                        | Heavy reports (guest ledger, roll-forward, …) computed at once per process (SCALABILITY §33)     |
| `REPORT_HEAVY_WAIT_MS`                    | 30000   | 0–120000                    | How long a heavy report waits for its slot before answering 429 `REPORTS_BUSY`                   |
| `READ_DATABASE_URL`                       | —       | URL                         | Optional streaming standby for closed-date reports only (SCALABILITY §35); unset = primary only  |
| `READ_DATABASE_POOL_MAX`                  | 3       | 1–50                        | Connections per process to the replica (counted on the replica, not the primary)                 |
| `READ_REPLICA_MAX_LAG_MS`                 | 30000   | 1000–600000                 | A replica further behind than this is skipped; reads go to the primary                           |
| (fixed)                                   | UTC     | —                           | Session `TimeZone` (D29); `application_name=serene-management` identifies the connections        |

**Connection topology (SCALABILITY §32, ARCHITECTURE D64).**

- Each instance opens up to `DATABASE_POOL_MAX` pooled connections, plus one LISTEN connection for
  live updates and, with the inline job worker (`JOB_WORKER=inline`), one LISTEN for the worker. Every
  server bundle of the process (route handlers, rendered pages, the instrumentation bundle that runs
  the worker) shares that one pool (`lib/db/prisma.ts`; SCALABILITY §38.2). A separate `npm run
worker` process holds `DATABASE_POOL_MAX` + 1. Keep the worst case, instances × (max + 2) with
  inline workers or instances × (max + 1) + workers × (max + 1) without, plus one instance of rolling-update surge and 10
  (migrations, backups, monitoring, administrators), within `max_connections` − superuser reserve
  (`connectionBudget`, `lib/db/pool-config.ts`; table in SCALABILITY §37.10). `npm run ops:db-check`
  prints how many instances fit. The steady state is lower (idle connections close after 2 min;
  measured 13 per instance under load), but the budget is for the peak.
- Up to about 6 instances, connect directly and lower `DATABASE_POOL_MAX` as instances grow (e.g. 4 × 5).
  Beyond that, or with autoscaling, use PgBouncer in transaction mode:
  1. Point `DATABASE_URL` at PgBouncer and set `DATABASE_POOLER=pgbouncer-transaction`. The session
     settings are then not sent; set them on the runtime role:
     `ALTER ROLE serene_app SET TimeZone = 'UTC'; ALTER ROLE serene_app SET statement_timeout = '30s'; ALTER ROLE serene_app SET idle_in_transaction_session_timeout = '60s';`
  2. Set `REALTIME_DATABASE_URL` to a direct (session) connection: LISTEN does not work through a
     transaction pooler, and startup refuses the pooled mode without it.
     `MIGRATION_DATABASE_URL` and the backup commands also stay direct.
  3. PgBouncer: `pool_mode = transaction`, `default_pool_size` about 2–4 × the database server's cores,
     `max_client_conn` ≥ instances × `DATABASE_POOL_MAX`. Named prepared statements are not used, so
     `max_prepared_statements` is not needed.
  4. Run `npm run ops:db-check`: it fails when the zone is not UTC or a timeout is off.
- **Read replica (optional, not enabled by default; SCALABILITY §35).** The measured workload does not need one.
  - **Enable it** only when the primary's CPU is regularly above ≈ 60–70 % with instances not the limit, or when
    closed-date reporting measurably slows operations.
  - **Prerequisites:**
    - a streaming standby on its own host, with the same schema (it follows the primary);
    - a read-only login (`ALTER ROLE … SET default_transaction_read_only = on`, `SELECT` grants);
    - `hot_standby_feedback = on`, or a `max_standby_streaming_delay` above the report statement timeout;
    - `max_connections` on the standby ≥ instances × `READ_DATABASE_POOL_MAX` + monitoring;
    - replay-lag monitoring.
  - **Configure it.** Set `READ_DATABASE_URL` to the standby (direct, not through a transaction pooler) and run
    `npm run ops:db-check`. It reports the replica's state and lag, never its address, and warns when the URL is
    not a standby or is unreachable.
  - **Failure handling.** If the replica is down, lagging or erroring, those reports run on the primary (Server-Timing
    `db-read;desc="fallback=1"`). The primary is always required: a replica is never a failover target.

Notes:

- **Reports.** Row-level reports are capped at 20 000 rows (refused beyond it, never cut) and run within the normal statement timeout; the JSON view pages 500 rows at a time and the CSV export streams every row.
- **Long jobs.** The night audit runs in a background job (§7), not in the request. Its commit raises its own statement timeout to 5 minutes for its transaction only (`runInTransaction({ statementTimeoutMs })`). Interactive transactions keep their own limit: 15 s by default, 300 s for the night audit commit.
- **Sizing.** Total connections are (application processes × `DATABASE_POOL_MAX`) + maintenance and backup jobs + a few for administration. They must stay well under PostgreSQL's `max_connections` (100 by default). One process with 10 connections suits a hotel group on a small server. **Do not raise the pool to fix slowness.** Find the slow query first (`pg_stat_activity`, `pg_stat_statements`), because more connections usually add lock contention.
- **Tuning.** These values are starting points. Tune them against the server's CPU count and the measured load.
- **Database unreachable (measured for v1.0.0-rc1).** When PostgreSQL refuses or resets connections (restart, crash, failover with a reset), readiness turns 503 within about a second, the load balancer returns a fast 503, and every instance recovers on its own within a second of the database returning; no restart is needed. A network partition that heals (packets delayed, TCP retransmits) is also absorbed: requests wait and complete afterwards.
- **Dead database peer (operational risk).** The pool sets no client-side query timeout and no TCP keepalive. If the database host disappears without resetting connections (host power loss, a failover that moves the address, a firewall dropping state), queries already sent wait until the operating system abandons the connection, about 15 minutes with Linux defaults. Readiness reports 503 throughout, so traffic is shed rather than hung, but the instance does not heal sooner by itself. Mitigation now: on the application hosts set `net.ipv4.tcp_retries2 = 8` (about 100 s) in `/etc/sysctl.d/`, and after a database failover restart the instances (§12.3). Planned for a later release: `keepAlive` and a client query timeout in `lib/db/pool-config.ts`.
- **PgBouncer.** The settings travel as startup `options`. A transaction-pooling PgBouncer does not forward them, so either:
  - add `ignore_startup_parameters = options` to PgBouncer, and rely on the runtime role defaults that `runtime-role.sql` sets (`TimeZone=UTC`, `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`); or
  - use session pooling.
  - Prisma interactive transactions and advisory locks require that a transaction stays on one server connection, which transaction pooling does provide.

## 7. Background jobs

Work too long for a request (today: the night audit) is queued in the `background_jobs` table and executed by a worker (SCALABILITY §33, ARCHITECTURE D65). There is no broker: PostgreSQL is the queue.

**Where workers run.**

- **Default (`JOB_WORKER=inline`):** every application process runs one worker next to its requests. Nothing else to deploy; a single-server installation needs nothing more.
- **Separate workers:** set `JOB_WORKER=off` on the web processes and run `npm run worker` (`node --conditions=react-server dist/ops/worker.mjs`) under the process manager (systemd, NSSM, pm2), with the application's environment. Use this to keep long audits off the web processes' event loop, or to run workers on another host.
- Any mix is safe, on any number of hosts: a job is claimed by exactly one worker at a time (`FOR UPDATE SKIP LOCKED`), and every write a worker makes is fenced on its lease.

**What happens when things fail.**

| Event                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker process killed, host lost           | Its lease (`JOB_LEASE_MS`, 60 s) expires; any worker reclaims the job and retries it after 5 s · 2^(n−1) (at most 5 min).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Database restarts or the connection drops  | The attempt fails (or its lease expires) and is retried with backoff; the night audit commit rolled back as a whole, so nothing is half-done.                                                                                                                                                                                                                                                                                                                                                                                             |
| Every attempt fails (night audit: 3)       | The job is FAILED and, normally, the run is marked FAILED (`JOB_FAILED`) and the business date reopened. Nothing was posted. **Not guaranteed:** that last step runs once, after the job is FAILED; if the database is still unreachable then, or the worker dies at that moment, the run stays RUNNING and the date IN_AUDIT (postings answer 423). Recover it from the night audit page (`nightaudit:run`, Recover once the run is 2 minutes stale), and alert on `jobs_total{outcome="failed"}` (§11.3). PRODUCTION_READINESS.md P2-6. |
| A worker comes back after losing its lease | Every write it tries matches nothing (fencing); it stops.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Shutdown (SIGTERM/SIGINT)                  | Stops claiming, waits up to 60 s (inline: `SHUTDOWN_TIMEOUT_MS` − 2 s) for running jobs; anything still running is re-claimed elsewhere when its lease expires.                                                                                                                                                                                                                                                                                                                                                                           |

**Monitoring.** `npm run worker -- --stats` prints the queue's health as JSON: queued, due, running, expired leases, failed in the last 24 h, and the oldest due job's age in seconds. Alert when `oldestDueSeconds` grows past a few minutes (no worker is running) or `failedLast24h` is not 0. Workers print one JSON line per job event (no payloads). A run whose job no worker holds can be recovered from its page (Recover / Cancel audit).

**Draining.** `npm run worker -- --once` runs every due job, then exits (maintenance windows, or when no worker is deployed).

**Stopping a worker (measured for v1.0.0-rc1).** A graceful stop with no running job exits 0 within a second. Unlike a web instance, a worker has no overall shutdown bound: if its database connections are stuck (dead database peer, §6), closing the pool can wait indefinitely after "stopping". Always run workers under a service manager stop timeout (systemd `TimeoutStopSec=90`, DEPLOYMENT.md §11) that kills the process; any job it held is reclaimed after its lease. On Windows, one of eleven graceful worker stops in the rehearsal ended with a Node/libuv assertion at exit (`UV_HANDLE_CLOSING`, exit `0xC0000409`) after the worker had stopped claiming jobs; no job was affected, and the service manager restarts it.

## 8. Scheduling

Recurring jobs are plain commands started by the operating system's scheduler. Run them from the application directory, with the same environment as the application.

**Linux (cron)**, for example in `/etc/cron.d/serene`, running as the service user:

```
# m  h  dom mon dow  user    command
30  2  *   *   *    serene  cd /srv/serene && npm run --silent ops:backup -- create --out-dir /var/backups/serene >> /var/log/serene/backup.log 2>&1
50  2  *   *   *    serene  cd /srv/serene && npm run --silent ops:backup -- verify --file "$(ls -1 /var/backups/serene/*.dump | tail -n 1)" >> /var/log/serene/backup.log 2>&1
15  3  *   *   *    serene  cd /srv/serene && npm run --silent ops:maintenance >> /var/log/serene/maintenance.log 2>&1
```

Add the off-host copy and the pruning of old backups to the same schedule. Alert when a job exits non-zero or when no new backup appeared in 26 hours.

**Windows (Task Scheduler):**

```
schtasks /Create /TN "Serene maintenance" /SC DAILY /ST 03:15 /RU <service account> /TR "cmd /c cd /d D:\serene && npm run --silent ops:maintenance >> D:\serene\logs\maintenance.log 2>&1"
```

Create the backup and verify tasks the same way.

Schedule the backup before the maintenance run, and both away from the hotel's night audit time.

## 9. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. It does the following, and never deploys, pushes or tags:

1. Checks out the code and installs Node 22 (npm cache).
2. Installs PostgreSQL 18 **natively on the runner** from the official PGDG apt repository (no Docker, no service containers). It creates the `serene` role and the `serene_management` and `serene_management_test` databases, and writes a `.env` with throwaway, per-run random credentials. No repository secrets are used.
3. Runs `npm ci`, `format:check`, `typecheck`, `lint`, `test` (unit, PGlite database rules and integration against the runner's PostgreSQL) and `build`.
4. Checks the role split. It runs `db:deploy` and `ops:seed`, creates `serene_app` with `scripts/db/runtime-role.sql`, then runs `ops:db-check -- --strict` as the runtime role and `ops:maintenance -- --dry-run`.

`tests/unit/ci-workflow.test.ts` keeps the workflow honest: it must reference only existing npm scripts, use a supported Node version, and contain no Docker, secrets or deploy steps.

## 10. Several instances and graceful shutdown

The application is stateless per process: sessions, rate limits, jobs, live-update fan-out and audit
data live in PostgreSQL, so any instance can serve any request and no sticky sessions are needed
(state audit and measurements: SCALABILITY §37, ARCHITECTURE D69).

**Load balancer contract.**

| Item                     | Requirement                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health check             | `GET /api/health/ready`, unauthenticated, every 1–5 s; remove a target after 2 failures (503 `unavailable` or `draining`), re-add after 2 successes |
| Liveness (orchestrators) | `GET /api/health/live`: never touches PostgreSQL; restart only when it fails                                                                        |
| Affinity                 | None. Round-robin or least-connections                                                                                                              |
| Event streams            | `/api/v1/properties/{id}/events`: no buffering, idle/read timeout > 25 s (heartbeat), abort upstream when the client disconnects                    |
| Request timeout          | ≥ 60 s for normal requests (statement timeout 30 s; heavy reports may wait 30 s for a slot); streams end by themselves within 15 min                |
| Retries                  | Only idempotent requests (GET/HEAD) on connection errors; never retry POST/PUT/PATCH/DELETE automatically                                           |
| Forwarded headers        | Append to `X-Forwarded-For`; `TRUSTED_PROXY_HOPS` = number of appending proxies; `X-Real-IP` and `Forwarded` are ignored                            |
| Instances unreachable    | The Node port must be reachable only through the proxy chain when `TRUSTED_PROXY_HOPS` > 0                                                          |

**Graceful shutdown** (`npm start`, which sets `NEXT_MANUAL_SIG_HANDLE=true`; `lib/lifecycle`). On SIGTERM
or SIGINT (and Ctrl+Break, SIGBREAK, on Windows):

1. Readiness answers 503 `draining` at once; liveness stays 200; new event streams get 503 with
   `retry-after: 1` (the client retries and lands on another instance).
2. The inline job worker stops claiming; open event streams receive `reauth` (reason `shutdown`) and end.
3. For `SHUTDOWN_DRAIN_MS` (default 5 s) requests are still served while the load balancer notices.
   Set it ≥ health-check interval × unhealthy threshold.
4. In-flight API requests are awaited; running jobs get the remaining time.
5. The LISTEN connection and every database pool close; the process exits 0. The whole sequence is
   bounded by `SHUTDOWN_TIMEOUT_MS` (default 25 s); a hard exit follows 5 s later whatever happens.
   Give systemd `TimeoutStopSec` / NSSM `AppStopMethodConsole` at least `SHUTDOWN_TIMEOUT_MS` + 5 s.

Jobs still running at the end keep their lease and are re-claimed by another instance after
`JOB_LEASE_MS` (60 s). A crash (kill -9, power loss) skips all of this: the load balancer removes the
target on connection errors or failed readiness, clients reconnect, and leases expire as above.

**Rolling update.** Run `npm run db:deploy` once (DEPLOYMENT §4), then replace instances one at a
time: start the new one, wait for readiness 200, add it, then stop an old one with SIGTERM. Keep
one instance of surge headroom in the connection budget. Old and new releases may serve side by side,
so a rolling release's migration must be backwards compatible (expand now, contract in a later release).

**Measured for v1.0.0-rc1 (DEPLOYMENT.md §12).** Under steady load through the TLS load balancer: a hard kill of one instance and a graceful drain of the other lost no request (the balancer retried four in-flight GETs). A rolling rollback and roll-forward lost none of about 55 000 requests. A load-balancer **restart** is not invisible to open screens: the event streams reconnect within half a second, but a screen whose data request failed while the balancer was down shows "Cannot reach the server · Retry" until the user retries or returns to the tab. Prefer configuration reloads (`nginx -s reload`, HAProxy hitless reload), which keep connections, to restarts.

**Observability.** `INSTANCE_ID` (default host-pid-random) prefixes shutdown logs. With `SERVER_TIMING=1`
responses carry `x-instance-id` and the readiness body adds the instance's state (uptime, draining,
in-flight requests, open event streams, LISTEN state, worker activity). None of these carry secrets,
addresses or connection strings.

## 11. Observability

The production gate audit, its findings, the UAT and the release prerequisites are in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md); the security controls are indexed in [SECURITY.md](SECURITY.md).

Measured and validated in the final scalability phase (SCALABILITY §38, ARCHITECTURE D70).

### 11.1 Metrics: `GET /api/metrics`

Each application process serves its own metrics in the Prometheus text format (0.0.4). Prometheus or an OpenTelemetry Collector (`prometheus` receiver) can scrape it. Metric names follow the OpenTelemetry semantic conventions where one exists.

**Access:**

- Set `METRICS_TOKEN`: at least 32 random characters, refused in production when weak.
- Scrape every instance directly, with `Authorization: Bearer <token>`, never through the public load balancer.
- Without the token, or with a wrong one, the endpoint answers 404.
- Worker processes serve the same output with `npm run worker -- --metrics-port <port>` at `GET /metrics`, using the same token.

**What is never in the output:** tokens, credentials, addresses, connection strings, user names, e-mail addresses, amounts and query text. Labels are limited to:

- route templates, with every id replaced by `{id}`;
- method and status;
- job kind;
- rate-limit rule name;
- pool name;
- instance and role.

Each metric holds at most 1,000 label sets; further sets fold into `overflow="true"`.

| Area     | Metric                                                                                                           | Type      | Labels / notes                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requests | `http_server_request_duration_seconds`                                                                           | histogram | `method`, `route`, `status`. Count, rate, error rate and latency percentiles all derive from it. Event streams: until the response starts                                                        |
|          | `http_server_active_requests`                                                                                    | gauge     | In-flight API requests                                                                                                                                                                           |
| Database | `db_client_connection_wait_seconds`                                                                              | histogram | `pool`: waiting for a pooled connection                                                                                                                                                          |
|          | `db_client_connection_use_seconds`                                                                               | histogram | `pool`: how long a connection was held (query or transaction time)                                                                                                                               |
|          | `db_client_connection_count`                                                                                     | gauge     | `pool`, `state` (`used`, `idle`)                                                                                                                                                                 |
|          | `db_client_connection_max`                                                                                       | gauge     | `pool`                                                                                                                                                                                           |
|          | `db_client_connection_pending_requests`                                                                          | gauge     | `pool`: saturated while above 0                                                                                                                                                                  |
|          | `db_read_route_total`                                                                                            | counter   | `target` (`primary`, `replica`, `fallback`): replica-eligible reads                                                                                                                              |
| Jobs     | `jobs_total`                                                                                                     | counter   | `kind`, `outcome` (`finished`, `retry`, `failed`, `lease-lost`)                                                                                                                                  |
|          | `job_duration_seconds`                                                                                           | histogram | `kind`, `outcome`                                                                                                                                                                                |
|          | `job_queue_wait_seconds`                                                                                         | histogram | `kind`: created → claimed, first attempts                                                                                                                                                        |
|          | `jobs_reclaimed_total`                                                                                           | counter   | `kind`: leases released after a worker died                                                                                                                                                      |
|          | `jobs_running`                                                                                                   | gauge     | `state` (`running`, `slots`) for this process                                                                                                                                                    |
|          | `jobs_queue`                                                                                                     | gauge     | Cluster queue from PostgreSQL, refreshed at most every 10 s: `queued`, `due`, `running`, `expired_lease`, `failed_24h`, `oldest_due_seconds`. Same value on every instance: aggregate with `max` |
| Realtime | `realtime_streams_active`                                                                                        | gauge     | Open event streams on this instance                                                                                                                                                              |
|          | `realtime_streams_opened_total`                                                                                  | counter   | First connections and reconnects                                                                                                                                                                 |
|          | `realtime_streams_closed_total`                                                                                  | counter   | `reason` (`client`, `access`, `shutdown`, `expired`, `error`)                                                                                                                                    |
|          | `realtime_listener_up`                                                                                           | gauge     | 1 while the LISTEN connection is up                                                                                                                                                              |
|          | `realtime_listener_lost_total`                                                                                   | counter   | Each loss sends `degraded` to the streams                                                                                                                                                        |
|          | `realtime_notifications_total`                                                                                   | counter   | `kind`                                                                                                                                                                                           |
| Limits   | `rate_limit_rejections_total`                                                                                    | counter   | `rule`                                                                                                                                                                                           |
|          | `rate_limit_store_errors_total`                                                                                  | counter   | `rule`, `policy` (`allow`, `deny`)                                                                                                                                                               |
| Process  | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `process_uptime_seconds` | gauge     | —                                                                                                                                                                                                |
|          | `nodejs_eventloop_delay_seconds`                                                                                 | gauge     | `quantile` (0.5, 0.99, 1) over the last 15 s                                                                                                                                                     |
|          | `serene_instance_info`, `serene_instance_draining`                                                               | gauge     | `instance`, `role`                                                                                                                                                                               |

**Not covered by these metrics:**

- **PostgreSQL CPU and memory, and the server's own connection count:** monitor them on the database host (node/Windows exporter, `pg_stat_activity`, `postgres_exporter`).
- **End-to-end event delivery latency:** notifications carry no timestamp. It is measured externally (SCALABILITY §38.11).

### 11.2 Logs and correlation

**One request id end to end.** Configure the load balancer to set `X-Request-Id`, e.g. nginx `proxy_set_header X-Request-Id $request_id;` (log `$request_id` there too). The application keeps a valid incoming id; otherwise it uses a W3C `traceparent`'s trace id, otherwise a new UUID. It returns the id as `x-request-id`, and writes it to:

- error logs;
- slow-request logs;
- `audit_logs.request_id`;
- the payload of jobs the request queued, so a worker's job event lines carry `requestId`, and the job's own audit rows use it.

Live-update events carry the PostgreSQL transaction id (`x`), not the request id.

**Slow requests.** One JSON line per API request slower than `SLOW_REQUEST_MS` (default 2,000; 0 turns it off). It carries the request id, instance, method, route template, status, total, authentication and pool-wait milliseconds, and the number of checkouts. No path ids, query string, body, user or address are logged. Under saturation this is one line per slow request, so measure the log volume before lowering the threshold.

**Other logs:**

- **Errors:** redacted (G12).
- **Shutdown:** `[shutdown <instance>]`.
- **Worker events:** one JSON line per job event (`npm run worker`), including `queueWaitMs`, `runMs` and `requestId`.

### 11.3 Alerts (PROPOSED: thresholds from the measurements in SCALABILITY §38; tune per deployment)

| Alert              | Condition                                                                        | Why                                                                   |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Instance not ready | readiness ≠ 200 for 1 min on any instance, or on all                             | The database is unreachable, or the instance is draining              |
| Error rate         | 5xx / all > 1 % over 5 min                                                       | Measured 0 % at every load level, including overload                  |
| Latency            | p95 of `http_server_request_duration_seconds` > 2 s for 10 min                   | p95 was 0.4–0.8 s below saturation and 1.6 s at 2× it                 |
| Pool saturation    | `db_client_connection_pending_requests` > 0 for 5 min, or wait p95 > 250 ms      | The first sign of database or pool saturation (§38.6)                 |
| Event loop         | `nodejs_eventloop_delay_seconds{quantile="0.99"}` > 0.5 s for 5 min              | The process is CPU-bound                                              |
| Job queue          | `jobs_queue{state="oldest_due_seconds"}` > 120, or `expired_lease` > 0 for 5 min | No worker is running, or workers are dying                            |
| Job failures       | `jobs_total{outcome="failed"}` increases                                         | A night audit failed: someone must look                               |
| Realtime           | `realtime_listener_up` = 0 while `realtime_streams_active` > 0 for 2 min         | Screens fall back to polling                                          |
| Rate-limit store   | `rate_limit_store_errors_total` increases                                        | Login fails closed while the store is down                            |
| Memory             | RSS grows > 20 % per day with flat load                                          | No leak was measured over 26 min (§38.13); watch for it in production |

**Prometheus rules (v1.0.0-rc1).** The application series below were checked against a live scrape of the release (DEPLOYMENT.md §12). Counters such as `jobs_total`, `rate_limit_rejections_total` and `rate_limit_store_errors_total` appear only after their first event. Readiness comes from the blackbox exporter probing `/api/health/ready` on every instance; host, disk and PostgreSQL alerts need `node_exporter` (`windows_exporter` on Windows) and `postgres_exporter` on the database host. Validate the file with `promtool check rules` before loading it, and tune the thresholds per deployment.

```yaml
groups:
  - name: serene-app
    rules:
      - alert: SereneInstanceDown
        expr: up{job=~"serene-web|serene-worker"} == 0
        for: 2m
      - alert: SereneNotReady # also fires while an instance drains for a deploy: silence it during releases
        expr: probe_success{job="serene-ready"} == 0
        for: 1m
      - alert: SereneAllInstancesNotReady
        expr: sum(probe_success{job="serene-ready"}) == 0
        for: 1m
        labels: { severity: page }
      - alert: SereneErrorRate
        expr: sum(rate(http_server_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(http_server_request_duration_seconds_count[5m])) > 0.01
        for: 5m
      - alert: SereneLatencyP95
        expr: histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{route!~".*/events"}[5m]))) > 2
        for: 10m
      - alert: SerenePoolSaturated
        expr: max by (instance) (db_client_connection_pending_requests) > 0
        for: 5m
      - alert: SerenePoolWait
        expr: histogram_quantile(0.95, sum by (le, instance) (rate(db_client_connection_wait_seconds_bucket[5m]))) > 0.25
        for: 5m
      - alert: SereneEventLoopBlocked
        expr: nodejs_eventloop_delay_seconds{quantile="0.99"} > 0.5
        for: 5m
      - alert: SereneJobBacklog
        expr: max(jobs_queue{state="oldest_due_seconds"}) > 120 or max(jobs_queue{state="expired_lease"}) > 0
        for: 5m
      - alert: SereneJobFailed
        expr: increase(jobs_total{outcome="failed"}[15m]) > 0 or max(jobs_queue{state="failed_24h"}) > 0
        labels: { severity: page }
      - alert: SereneNoWorker
        expr: count(up{job="serene-worker"} == 1) == 0
        for: 2m
      - alert: SereneRealtimeListenerDown
        expr: realtime_listener_up == 0 and on(instance) realtime_streams_active > 0
        for: 2m
      - alert: SereneRateLimitStoreErrors
        expr: increase(rate_limit_store_errors_total[10m]) > 0
      - alert: SereneLoginRejectionsSpike
        expr: sum(rate(rate_limit_rejections_total{rule=~"auth.*"}[10m])) > 1
        for: 10m
      - alert: SereneMemoryHigh
        expr: process_resident_memory_bytes > 1.5e9
        for: 15m
  - name: serene-infrastructure
    rules:
      - alert: PostgresDown
        expr: pg_up == 0
        for: 1m
        labels: { severity: page }
      - alert: PostgresConnectionsHigh
        expr: sum(pg_stat_activity_count) / max(pg_settings_max_connections) > 0.8
        for: 5m
      - alert: HostCpuHigh
        expr: 1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) > 0.85
        for: 15m
      - alert: HostMemoryLow
        expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1
        for: 10m
      - alert: DiskSpaceLow
        expr: node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes < 0.15
        for: 10m
      - alert: BackupMissing
        expr: time() - serene_backup_last_success_timestamp_seconds > 26 * 3600
        labels: { severity: page }
      - alert: TlsCertificateExpiring
        expr: probe_ssl_earliest_cert_expiry - time() < 14 * 86400
```

`serene_backup_last_success_timestamp_seconds` is not exported by the application: have the nightly backup job write it through the `node_exporter` textfile collector after the off-host copy succeeds (§2.6), for example `echo "serene_backup_last_success_timestamp_seconds $(date +%s)" > /var/lib/node_exporter/textfile/serene_backup.prom`.

### 11.4 Slow queries in PostgreSQL (recommended production settings, not enabled locally)

| Setting                                                    | Recommendation                                                                                                                                                               | Cost / note                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_stat_statements`                                       | **Enable**: `shared_preload_libraries = 'pg_stat_statements'`, `pg_stat_statements.max = 5000`, `track = top`, then `CREATE EXTENSION pg_stat_statements` (restart required) | A few % of CPU at most; the per-query totals behind every query optimization so far. Version 1.12 is available on the development server but not loaded (not changed: it needs a restart) |
| `log_min_duration_statement`                               | `1000` (ms)                                                                                                                                                                  | Logs statement text with values: treat the server log as sensitive (guest names in search terms)                                                                                          |
| `auto_explain`                                             | Load per session or briefly (`auto_explain.log_min_duration = 3000`, `log_analyze = off`)                                                                                    | `log_analyze = on` slows every statement; never leave it on globally                                                                                                                      |
| `log_lock_waits`                                           | `on` (logs waits beyond `deadlock_timeout`, 1 s)                                                                                                                             | Cheap; shows lock queues (rooms, folios, the night audit)                                                                                                                                 |
| `track_io_timing`                                          | `on` after `pg_test_timing` shows a cheap clock                                                                                                                              | Adds I/O timings to `EXPLAIN (BUFFERS)` and `pg_stat_statements`                                                                                                                          |
| `client_connection_check_interval`                         | `10s`                                                                                                                                                                        | Ends the work of a client that vanished mid-statement sooner (measured: an orphaned backend waited for its lock, §38.9)                                                                   |
| `idle_in_transaction_session_timeout`, `statement_timeout` | Already set per connection (§6)                                                                                                                                              | —                                                                                                                                                                                         |

## 12. Runbooks

Commands assume the reference topology (DEPLOYMENT.md §11): releases in `/srv/serene/releases/<version>`, `/srv/serene/current` pointing at the live one, systemd units `serene-web@<port>` and `serene-worker@<metricsPort>`, and the production environment in `/etc/serene/serene.env`. Run `ops:*` commands from `/srv/serene/current` with that environment loaded. Never paste secrets into a ticket or chat.

### 12.1 Health checks

| Check                    | Command                                                                                          | Healthy                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Liveness (per instance)  | `curl -fsS http://<instance>:3000/api/health/live`                                               | 200 `ok`. Failing = restart that process                                  |
| Readiness (per instance) | `curl -fsS http://<instance>:3000/api/health/ready`                                              | 200 `ready`. 503 `unavailable` = database; 503 `draining` = shutting down |
| Public path              | `curl -fsS https://<APP_URL host>/api/health/ready`                                              | 200 through the load balancer                                             |
| Database posture         | `npm run ops:db-check -- --strict`                                                               | no `FAIL`/`WARN` lines (exit 0)                                           |
| Job queue                | `npm run worker -- --stats`                                                                      | `oldestDueSeconds` < 120, `expiredLeases` 0, `failedLast24h` 0            |
| Metrics                  | `curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://<instance>:3000/api/metrics \| head` | Prometheus text; 404 means a missing or wrong token                       |

Do not restart an instance whose liveness passes while readiness fails: the database is the problem (§12.9).

### 12.2 Deploy and rollback

**Deploy** (every release; DEPLOYMENT.md §9 has the full checklist):

1. Back up and verify (§2.2), then encrypt and copy off the host (§2.6). Note the file name.
2. Unpack and build the new release into `/srv/serene/releases/<version>` (DEPLOYMENT.md §3). Never build inside `current`.
3. `npm run db:deploy` and `npm run ops:seed` once, from the new release directory (only when the release has migrations or new permissions; safe to repeat).
4. Switch `current` to the new release: `ln -sfn /srv/serene/releases/<version> /srv/serene/current`.
5. Rolling restart, one web instance at a time: `systemctl restart serene-web@3000`, wait until its readiness is 200 and the load balancer shows it healthy, then the next instance. With open-source nginx, take the instance out of `upstream` and reload first (§12.4).
6. Restart the workers: `systemctl restart serene-worker@9101 serene-worker@9102`.
7. Smoke checks: DEPLOYMENT.md §9 step 9, `ops:db-check -- --strict`, and the alert dashboard for 30 minutes.

**Application rollback** (the schema did not change, or changed backward-compatibly):

1. `ln -sfn /srv/serene/releases/<previous> /srv/serene/current`.
2. Rolling restart of the web instances, then the workers (steps 5–6 above). Rehearsed for v1.0.0-rc1 under load with no failed request (DEPLOYMENT.md §12).
3. `npm run ops:db-check -- --strict` and the smoke checks.

**Worker rollback.** Workers run the release in `current`, so step 2 covers them; restart them after the web instances. Between `a70992d` and v1.0.0-rc1 the job kinds and payloads are unchanged, so either release's worker runs the other's jobs. For a future release that changes a job payload, drain the queue (`npm run worker -- --stats` shows nothing queued or running) before rolling workers across that change.

**Migration compatibility.** Migrations are never rolled back (§3.2), and nothing in this repository reverses an applied migration.

- **No migrations in the release, or only expanding ones** (new tables, columns, indexes): the previous release runs against the new schema; an application rollback is enough. Between `a70992d` and v1.0.0-rc1 there are no schema changes.
- **A release that drops, renames or rewrites data:** the previous release may not run against the new schema. Do not roll the application back alone. Either fix forward with a new release, or restore the pre-deploy backup (step 1 of the deploy) into a new database and switch to it (§2.4). Everything written since the backup is then lost and must be re-entered.
- **First go-live** has no previous production release: a rollback means taking the service offline (emergency shutdown below) and, if needed, restoring the pre-go-live backup.

**Emergency shutdown** (data at risk, security incident, runaway writes):

1. Stop new traffic at the load balancer: serve a static maintenance page or remove every upstream (nginx: `return 503;` in the `location /` block, then reload).
2. `systemctl stop serene-worker@*` so no job continues (a running night audit commit either finishes or rolls back as a whole).
3. `systemctl stop serene-web@*` (graceful; bounded by `TimeoutStopSec`).
4. Leave PostgreSQL running for investigation. Take a backup (§2.2) before changing anything.
5. To bring the service back: start the workers, then the web instances, check readiness, restore the load balancer configuration.

### 12.3 Restart

- **One instance:** `systemctl restart serene-web@3000` (graceful: readiness 503 `draining`, in-flight requests finish, at most `SHUTDOWN_TIMEOUT_MS` + 5 s). Its event streams reconnect to the other instances.
- **All instances** (for example after a database failover, §6): restart them one at a time and wait for readiness between them. A simultaneous restart of every instance is an outage of a few seconds; announce it.
- **After a crash** systemd restarts the process (`Restart=on-failure`). Check `journalctl -u serene-web@3000` for the cause before restarting it by hand again.

### 12.4 Drain an instance

1. HAProxy or a cloud load balancer: send SIGTERM (`systemctl stop serene-web@3000`). Readiness answers 503 `draining` at once and the balancer removes the instance within 2 health checks; the instance serves for `SHUTDOWN_DRAIN_MS` more, then finishes in-flight requests and exits.
2. Open-source nginx (passive checks only): comment out the instance in `upstream`, `nginx -t && nginx -s reload`, wait 30 s, then stop it. Put it back the same way after the restart.
3. Confirm: `serene_instance_draining` = 1 while draining; no new 5xx in the access log.

### 12.5 Worker restart

1. `npm run worker -- --stats`: note any running job.
2. `systemctl restart serene-worker@9101`. The worker stops claiming, waits up to 60 s for its running job, and exits. A job still running is reclaimed after its lease (`JOB_LEASE_MS`, 60 s) by another worker; the night audit commit is atomic, so nothing is half-done.
3. If the stop times out (systemd kills it after `TimeoutStopSec`), check `--stats` after a minute: `expiredLeases` should return to 0 as another worker reclaims the job.
4. With no worker running, queued jobs wait (`SereneNoWorker` alert). `npm run worker -- --once` runs the due jobs and exits.

### 12.6 Database backup

Nightly by the scheduler (§8): `ops:backup create` → `verify` → encrypt → off-host copy → checksum check there → remove the local plaintext → write the backup timestamp for monitoring (§2.6, §11.3). On demand (before a release or a risky operation) run the same steps by hand and note the file name.

### 12.7 Database restore

- **Drill or inspection:** restore into a new database (§2.3). Never restore over the production database; `ops:backup restore` refuses it.
- **Production recovery:** §2.4 (stop writes, keep the damaged database renamed, restore into a new one, re-apply the runtime-role grants, `db:deploy` if needed, `ops:db-check --strict`, smoke checks, tell the hotel which window to re-enter).

### 12.8 Stuck night audit

Symptoms: the business date stays `IN_AUDIT`, postings answer 423 `BUSINESS_DATE_LOCKED`, the night audit page shows a run that does not progress.

1. Look before acting: `npm run worker -- --stats` (running job? expired lease? failures?) and the workers' logs (`journalctl -u 'serene-worker@*'`, one JSON line per job event with the run's `requestId`).
2. **A worker is still running it** (job RUNNING, lease being renewed): wait. A large property's commit can take minutes (its statement timeout is 5 minutes). Recovery is refused while a worker holds the run (409 `NIGHT_AUDIT_IN_PROGRESS`).
3. **No worker holds it** (worker crashed, or every attempt failed and the give-up step could not run, PRODUCTION_READINESS P2-6): once the run is at least 2 minutes old, a user with `nightaudit:run` opens Night audit → the run → **Recover** (a running run) or **Cancel audit** (a queued run whose job never started), giving a reason. API: `POST /api/v1/properties/{propertyId}/night-audits/{runId}/recover` with `{ "reason": "…" }`. The run becomes FAILED and the date reopens. Nothing was posted: a failed commit rolls back as a whole.
4. Fix the cause (database reachable, a worker running, the blocking check resolved), then start the audit again from the page. Re-running is safe.
5. Record the incident with the run id and request id (§12.9).

### 12.9 Incident response

1. **Detect and declare.** An alert (§11.3) or a hotel call. Name one incident lead; note the start time.
2. **Triage with §12.1:**
   - liveness fails → process problem: restart that instance (§12.3);
   - readiness fails on every instance, liveness passes → database: check PostgreSQL (`pg_isready`, server log, disk space, connections). Do not restart the application in a loop; after the database returns, instances recover by themselves (§6). After a failover that moved the database address, restart the instances;
   - 5xx or latency on one route → slow-request log lines (`SLOW_REQUEST_MS`) by request id; `pg_stat_activity` for long queries or lock waits;
   - jobs stuck → §12.5, night audit → §12.8;
   - live updates down (`realtime_listener_up` 0) → screens fall back to polling; restart the affected instance at a quiet moment;
   - suspected compromise → emergency shutdown (§12.2), preserve logs and the database, rotate `AUTH_*` secrets (signs everyone out) and the database passwords, then investigate.
3. **Stabilize before fixing.** Prefer shedding load or rolling back (§12.2) over live changes.
4. **Communicate.** Tell the front office what works (the offline view shows today's arrivals, departures, in-house guests and rooms read-only; writes need the server) and the expected time to recovery.
5. **Close.** Confirm health (§12.1), check that the night audit for the affected date ran, and write a short report: timeline, cause, data affected (with the request ids and audit-log rows), and follow-up actions.

### 12.10 Monitoring

Scrape every web instance's `/api/metrics` and every worker's `/metrics` directly with the bearer token (§11.1), probe each instance's `/api/health/ready` and the public URL with the blackbox exporter, run `node_exporter` on every host and `postgres_exporter` on the database host, and load the rules in §11.3. Review the dashboard after every deploy and weekly: error rate, p95 latency, pool wait, job queue age, failed jobs, the last backup time, disk space and certificate expiry.
