# Operations

Running SERENE MANAGEMENT in production after it is deployed: backups and recovery, migrations, database roles, data retention, connection settings, scheduling and CI. Installation and the release runbook are in [DEPLOYMENT.md](DEPLOYMENT.md). Everything here uses native PostgreSQL and the commands in this repository. There is no Docker, no Redis and no background worker.

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
- **Encrypt backup storage.** Backups contain guest personal data, audit trails and password hashes. Store them on an encrypted volume, or encrypt each file before it leaves the host (for example `age` or `gpg` with a key kept away from the backups). Limit read access to operators.
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

1. Pick last night's backup (or a copied off-site one) and verify it:
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
  outbox PENDING       5120 retained (never pruned)
```

The durations are defined in `modules/retention/retention.policy.ts`; change them there and in this table together.

## 6. Connection pool and timeouts

The application uses one connection pool per process (`lib/db/pool-config.ts`). Every setting is explicit:

| Variable                                  | Default | Range        | Meaning                                                                                   |
| ----------------------------------------- | ------- | ------------ | ----------------------------------------------------------------------------------------- |
| `DATABASE_POOL_MAX`                       | 10      | 1–50         | Connections per application process                                                       |
| `DATABASE_CONNECT_TIMEOUT_MS`             | 5000    | 500–60000    | Wait for a new connection before failing the request                                      |
| `DATABASE_STATEMENT_TIMEOUT_MS`           | 30000   | 1000–600000  | Any single statement is cancelled after this (`57014`)                                    |
| `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | 60000   | 1000–3600000 | A transaction left idle (a bug) is ended so it cannot hold row locks                      |
| (fixed)                                   | UTC     | —            | Session `TimeZone` (D29); `application_name=serene-management` identifies the connections |

Notes:

- **Long jobs.** The night audit commit raises its own statement timeout to 5 minutes for its transaction only (`runInTransaction({ statementTimeoutMs })`). Interactive transactions keep their own limit: 15 s by default, 300 s for the night audit commit.
- **Sizing.** Total connections are (application processes × `DATABASE_POOL_MAX`) + maintenance and backup jobs + a few for administration. They must stay well under PostgreSQL's `max_connections` (100 by default). One process with 10 connections suits a hotel group on a small server. **Do not raise the pool to fix slowness.** Find the slow query first (`pg_stat_activity`, `pg_stat_statements`), because more connections usually add lock contention.
- **Tuning.** These values are starting points. Tune them against the server's CPU count and the measured load.
- **PgBouncer.** The settings travel as startup `options`. A transaction-pooling PgBouncer does not forward them, so either:
  - add `ignore_startup_parameters = options` to PgBouncer, and rely on the runtime role defaults that `runtime-role.sql` sets (`TimeZone=UTC`, `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`); or
  - use session pooling.
  - Prisma interactive transactions and advisory locks require that a transaction stays on one server connection, which transaction pooling does provide.

## 7. Scheduling (no worker process)

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

## 8. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. It does the following, and never deploys, pushes or tags:

1. Checks out the code and installs Node 22 (npm cache).
2. Installs PostgreSQL 18 **natively on the runner** from the official PGDG apt repository (no Docker, no service containers). It creates the `serene` role and the `serene_management` and `serene_management_test` databases, and writes a `.env` with throwaway, per-run random credentials. No repository secrets are used.
3. Runs `npm ci`, `format:check`, `typecheck`, `lint`, `test` (unit, PGlite database rules and integration against the runner's PostgreSQL) and `build`.
4. Checks the role split. It runs `db:deploy` and `ops:seed`, creates `serene_app` with `scripts/db/runtime-role.sql`, then runs `ops:db-check -- --strict` as the runtime role and `ops:maintenance -- --dry-run`.

`tests/unit/ci-workflow.test.ts` keeps the workflow honest: it must reference only existing npm scripts, use a supported Node version, and contain no Docker, secrets or deploy steps.
