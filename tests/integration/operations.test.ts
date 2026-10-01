import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { pgPoolConfig } from "@/lib/db/pool-config";
import { prisma } from "@/lib/db/prisma";
import { databaseErrorCode, runInTransaction } from "@/lib/db/transaction";
import { runRetention } from "@/modules/retention/retention.service";
import { seedReferenceData } from "@/prisma/seed/reference";

/**
 * Phase 10 batch 3: operations and reliability (H6 retention, M19 session
 * settings, L8 TRUNCATE guards on a real server, H7 backup/restore tooling).
 * Runs against throwaway databases on the same native PostgreSQL server,
 * migrated from scratch and dropped afterwards, so pruning and restores never
 * touch the shared test database.
 */

const baseUrl = new URL(process.env.DATABASE_URL!);
const password = decodeURIComponent(baseUrl.password);
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const OPS_DB = `serene_ops_${suffix}_test`;
const RESTORE_DB = `serene_ops_${suffix}_r_test`;
const urlFor = (name: string) => {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${name}`;
  return url.toString();
};

// Pinned clock: every retention expectation is relative to it, not to today.
const NOW = new Date("2031-03-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const settings = {
  DATABASE_URL: urlFor(OPS_DB),
  DATABASE_POOL_MAX: 4,
  DATABASE_CONNECT_TIMEOUT_MS: 5_000,
  DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 60_000,
};
const clients: PrismaClient[] = [];
const client = (overrides: Partial<typeof settings> = {}) => {
  const created = new PrismaClient({
    adapter: new PrismaPg(pgPoolConfig({ ...settings, ...overrides })),
  });
  clients.push(created);
  return created;
};

async function admin(sql: string) {
  const url = new URL(baseUrl.toString());
  url.pathname = "/postgres";
  const connection = new pg.Client({ connectionString: url.toString() });
  await connection.connect();
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
}

/** Runs a compiled operational command against a throwaway database. */
function ops(bundle: string, args: string[], database = OPS_DB) {
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", `dist/ops/${bundle}.mjs`, ...args],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: urlFor(database),
        MIGRATION_DATABASE_URL: urlFor(database),
      },
      encoding: "utf8",
    },
  );
  const output = `${result.stdout}${result.stderr}`;
  // No command ever prints the database password or connection string.
  expect(output).not.toContain(password);
  expect(output).not.toContain(urlFor(database));
  return { status: result.status, output };
}

let db: PrismaClient;
let userId: string;
const backupDir = mkdtempSync(join(tmpdir(), "serene-backup-"));

beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/ops/build.mjs"], { stdio: "pipe" });
  await admin(`CREATE DATABASE "${OPS_DB}" TEMPLATE template0 ENCODING 'UTF8'`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: urlFor(OPS_DB), MIGRATION_DATABASE_URL: urlFor(OPS_DB) },
    stdio: "pipe",
  });
  db = client();
  await seedReferenceData(db);
  const org = await db.organization.create({
    data: { code: "OPSORG", name: "Ops Org", baseCurrency: "PKR" },
  });
  userId = (
    await db.user.create({
      data: { organizationId: org.id, email: `ops.${suffix}@example.com`, displayName: "Ops" },
    })
  ).id;
}, 180_000);

afterAll(async () => {
  for (const created of clients) await created.$disconnect();
  for (const name of [RESTORE_DB, OPS_DB]) {
    await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  rmSync(backupDir, { recursive: true, force: true });
}, 60_000);

// --- H6 -----------------------------------------------------------------------------------

describe("H6 retention maintenance", () => {
  const ids: Record<string, string> = {};
  const session = async (name: string, expiresAt: Date, revokedAt: Date | null) => {
    ids[name] = (
      await db.authSession.create({
        data: {
          userId,
          refreshTokenHash: randomUUID().replace(/-/g, "").padEnd(64, "0"),
          expiresAt,
          revokedAt,
        },
      })
    ).id;
  };
  const resetToken = async (name: string, expiresAt: Date, usedAt: Date | null) => {
    ids[name] = (
      await db.passwordResetToken.create({
        data: {
          userId,
          tokenHash: randomUUID().replace(/-/g, "").padEnd(64, "1"),
          expiresAt,
          usedAt,
        },
      })
    ).id;
  };
  const idempotencyKey = (key: string, expiresAt: Date) =>
    db.idempotencyKey.create({
      data: { userId, key, route: "POST /x", requestHash: "0".repeat(64), expiresAt },
    });
  const outbox = async (
    name: string,
    status: "PENDING" | "PUBLISHED" | "FAILED",
    occurredAt: Date,
    publishedAt: Date | null = null,
  ) => {
    ids[name] = (
      await db.outboxEvent.create({
        data: {
          aggregateType: "Test",
          aggregateId: name,
          eventType: "test.event",
          payload: {},
          status,
          occurredAt,
          publishedAt,
        },
      })
    ).id;
  };

  beforeAll(async () => {
    await session("sessionExpiredLongAgo", ago(40), null);
    await session("sessionRevokedLongAgo", new Date(NOW.getTime() + 5 * DAY), ago(31));
    await session("sessionActive", new Date(NOW.getTime() + 5 * DAY), null);
    await session("sessionRecentlyExpired", ago(1), null);
    await session("sessionRecentlyRevoked", new Date(NOW.getTime() + 5 * DAY), ago(2));
    await resetToken("tokenExpiredLongAgo", ago(8), null);
    await resetToken("tokenUsedLongAgo", new Date(NOW.getTime() + DAY), ago(8));
    await resetToken("tokenRecentlyExpired", ago(1), null);
    await resetToken("tokenActive", new Date(NOW.getTime() + 60_000), null);
    await idempotencyKey("key-expired-long-ago-000001", ago(8));
    await idempotencyKey("key-recently-expired-00001", ago(1));
    await idempotencyKey("key-still-replayable-00001", new Date(NOW.getTime() + DAY));
    await outbox("pendingAncient", "PENDING", ago(400));
    await outbox("publishedOld", "PUBLISHED", ago(40), ago(31));
    await outbox("publishedRecent", "PUBLISHED", ago(10), ago(5));
    await outbox("failedOld", "FAILED", ago(91));
    await outbox("failedRecent", "FAILED", ago(10));
    // Shared rate-limit windows (D59): only windows that ended over a day ago go.
    await db.rateLimitWindow.createMany({
      data: [
        { key: "test.retention:ended-long-ago", count: 3, resetAt: ago(2) },
        { key: "test.retention:ended-recently", count: 3, resetAt: new Date(NOW.getTime() - HOUR) },
        { key: "test.retention:live", count: 1, resetAt: new Date(NOW.getTime() + HOUR) },
      ],
    });
  });

  const counts = (
    report: Awaited<ReturnType<typeof runRetention>>,
    field: "deleted" | "eligible",
  ) => Object.fromEntries(report.targets.map((t) => [t.target, t[field]]));

  it("dry run counts what the policy would remove and deletes nothing", async () => {
    const report = await runRetention(db, { now: NOW, dryRun: true });
    expect(counts(report, "eligible")).toEqual({
      authSessions: 2,
      passwordResetTokens: 2,
      idempotencyKeys: 1,
      outboxPublished: 1,
      outboxFailed: 1,
      rateLimitWindows: 1,
      backgroundJobs: 0,
    });
    expect(report.pendingOutboxRetained).toBe(1);
    expect(await db.authSession.count()).toBe(5);
    expect(await db.outboxEvent.count()).toBe(5);
  });

  it("removes expired records, preserves active ones and every pending outbox event", async () => {
    const report = await runRetention(db, { now: NOW, batchSize: 10 });
    expect(counts(report, "deleted")).toEqual({
      authSessions: 2,
      passwordResetTokens: 2,
      idempotencyKeys: 1,
      outboxPublished: 1,
      outboxFailed: 1,
      rateLimitWindows: 1,
      backgroundJobs: 0,
    });
    const left = async <T extends { id: string }>(rows: Promise<T[]>) =>
      (await rows).map((row) => Object.entries(ids).find(([, id]) => id === row.id)?.[0]).sort();
    expect(await left(db.authSession.findMany({ select: { id: true } }))).toEqual([
      "sessionActive",
      "sessionRecentlyExpired",
      "sessionRecentlyRevoked",
    ]);
    expect(await left(db.passwordResetToken.findMany({ select: { id: true } }))).toEqual([
      "tokenActive",
      "tokenRecentlyExpired",
    ]);
    expect(
      (await db.idempotencyKey.findMany({ select: { key: true } })).map((k) => k.key).sort(),
    ).toEqual(["key-recently-expired-00001", "key-still-replayable-00001"]);
    expect(await left(db.outboxEvent.findMany({ select: { id: true } }))).toEqual([
      "failedRecent",
      "pendingAncient",
      "publishedRecent",
    ]);
    expect(
      (await db.rateLimitWindow.findMany({ select: { key: true } })).map((w) => w.key).sort(),
    ).toEqual(["test.retention:ended-recently", "test.retention:live"]);
  });

  it("is safe to repeat: a second run finds nothing", async () => {
    const report = await runRetention(db, { now: NOW });
    expect(Object.values(counts(report, "deleted"))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await db.outboxEvent.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("deletes in bounded batches and stops at the batch limit", async () => {
    for (let i = 0; i < 25; i++) {
      await idempotencyKey(`bulk-expired-key-${String(i).padStart(8, "0")}`, ago(30));
    }
    const limited = await runRetention(db, { now: NOW, batchSize: 10, maxBatches: 2 });
    const keys = limited.targets.find((t) => t.target === "idempotencyKeys")!;
    expect(keys).toMatchObject({ deleted: 20, truncated: true });
    const rest = await runRetention(db, { now: NOW, batchSize: 10 });
    expect(rest.targets.find((t) => t.target === "idempotencyKeys")).toMatchObject({
      deleted: 5,
      truncated: false,
    });
    await expect(runRetention(db, { now: NOW, batchSize: 5 })).rejects.toThrow(RangeError);
  });

  it("runs as an operator command that prints counts only", () => {
    const dry = ops("maintenance", ["--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain("Retention dry run (nothing deleted)");
    expect(dry.output).toMatch(/outbox PENDING\s+1 retained/);
    expect(dry.output).not.toContain(ids.pendingAncient!);
    const real = ops("maintenance", []);
    expect(real.status).toBe(0);
    expect(real.output).toMatch(/authSessions\s+\d+ deleted/);
    expect(ops("maintenance", ["--batch-size", "5"]).status).toBe(2);
    expect(ops("maintenance", ["--unknown"]).status).toBe(2);
  });
});

// --- M19 ----------------------------------------------------------------------------------

describe("M19 session settings", () => {
  it("runs every pooled session in UTC with statement and idle-transaction timeouts", async () => {
    const [row] = await db.$queryRaw<
      { tz: string; st: string; idle: string; app: string }[]
    >`SELECT current_setting('TimeZone') AS tz, current_setting('statement_timeout') AS st,
             current_setting('idle_in_transaction_session_timeout') AS idle,
             current_setting('application_name') AS app`;
    expect(row).toEqual({ tz: "UTC", st: "30s", idle: "1min", app: "serene-management" });
  });

  it("cancels a statement that runs past the timeout", async () => {
    const strict = client({ DATABASE_STATEMENT_TIMEOUT_MS: 1_000 });
    const error = await strict.$queryRaw`SELECT pg_sleep(3)`.catch((e: unknown) => e);
    expect(databaseErrorCode(error)).toBe("57014");
    // The pool stays usable afterwards.
    expect(await strict.$queryRaw`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
  });

  it("lets a transaction raise its own statement timeout without changing the session", async () => {
    const inside = await runInTransaction(
      (tx) => tx.$queryRaw<{ st: string }[]>`SELECT current_setting('statement_timeout') AS st`,
      { statementTimeoutMs: 300_000 },
    );
    expect(inside[0]!.st).toBe("5min");
    const after = await prisma.$queryRaw<
      { st: string }[]
    >`SELECT current_setting('statement_timeout') AS st`;
    expect(after[0]!.st).toBe("30s");
  });
});

// --- L8 -----------------------------------------------------------------------------------

describe("L8 audit integrity on PostgreSQL", () => {
  it("rejects TRUNCATE of the audit log and cascading truncates, keeping the rows", async () => {
    const org = await db.organization.findFirstOrThrow({ select: { id: true } });
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        actorType: "SYSTEM",
        action: "test.ops",
        resourceType: "Test",
        risk: "STANDARD",
      },
    });
    const before = await db.auditLog.count();
    for (const sql of ["TRUNCATE audit_logs", "TRUNCATE organizations CASCADE"]) {
      const error = await db.$executeRawUnsafe(sql).catch((e: unknown) => e);
      expect(databaseErrorCode(error), sql).toBe("SM001");
    }
    expect(await db.auditLog.count()).toBe(before);
  });

  it("reports the database posture without secrets", () => {
    const check = ops("db-check", []);
    expect(check.status).toBe(0);
    expect(check.output).toContain("OK    guard triggers present and enabled on 15 tables");
    expect(check.output).toContain("TimeZone=UTC");
    // A single owner role (development) is reported, and fails --strict.
    expect(check.output).toMatch(/WARN {2}runtime role .* owns \d+ tables/);
    expect(ops("db-check", ["--strict"]).status).toBe(1);
  });
});

// --- H7 -----------------------------------------------------------------------------------

describe("H7 backup and restore", () => {
  let file: string;

  it("creates a checksummed custom-format backup and verifies it", () => {
    const created = ops("backup", ["create", "--out-dir", backupDir]);
    expect(created.status).toBe(0);
    const dumps = readdirSync(backupDir).filter((name) => name.endsWith(".dump"));
    expect(dumps).toHaveLength(1);
    expect(readdirSync(backupDir)).toContain(`${dumps[0]}.sha256`);
    file = join(backupDir, dumps[0]!);
    const verified = ops("backup", ["verify", "--file", file]);
    expect(verified.status).toBe(0);
    expect(verified.output).toContain("(matches)");
    const listed = ops("backup", ["list", "--dir", backupDir]);
    expect(listed.output).toContain(dumps[0]);
  });

  it("refuses unconfirmed, live-database and non-empty restore targets", () => {
    expect(ops("backup", []).status).toBe(2);
    expect(ops("backup", ["restore", "--file", file, "--target-db", RESTORE_DB]).status).toBe(2);
    expect(
      ops("backup", [
        "restore",
        "--file",
        file,
        "--target-db",
        RESTORE_DB,
        "--confirm-target",
        `${RESTORE_DB}x`,
      ]).status,
    ).toBe(2);
    // The database the application is configured with is never a target.
    const live = ops("backup", [
      "restore",
      "--file",
      file,
      "--target-db",
      OPS_DB,
      "--confirm-target",
      OPS_DB,
    ]);
    expect(live.status).toBe(2);
    expect(live.output).toContain("Refusing to restore into the database the application uses");
    // A missing target needs --create.
    expect(
      ops("backup", [
        "restore",
        "--file",
        file,
        "--target-db",
        RESTORE_DB,
        "--confirm-target",
        RESTORE_DB,
      ]).status,
    ).toBe(2);
  });

  it("restores into a new database that passes the posture check (restore drill)", async () => {
    const restored = ops("backup", [
      "restore",
      "--file",
      file,
      "--target-db",
      RESTORE_DB,
      "--confirm-target",
      RESTORE_DB,
      "--create",
    ]);
    expect(restored.status, restored.output).toBe(0);
    const copy = client({ DATABASE_URL: urlFor(RESTORE_DB) });
    expect(await copy.organization.count()).toBe(await db.organization.count());
    expect(await copy.auditLog.count()).toBe(await db.auditLog.count());
    const migrations = (db: PrismaClient) =>
      db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM _prisma_migrations`;
    expect(await migrations(copy)).toEqual(await migrations(db));
    const status = spawnSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "status"],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlFor(RESTORE_DB),
          MIGRATION_DATABASE_URL: urlFor(RESTORE_DB),
        },
        encoding: "utf8",
      },
    );
    expect(status.stdout).toContain("Database schema is up to date");
    const check = ops("db-check", [], RESTORE_DB);
    expect(check.status, check.output).toBe(0);
    expect(check.output).toContain("OK    guard triggers present and enabled on 15 tables");

    // Restoring again into the now non-empty database is refused.
    expect(
      ops("backup", [
        "restore",
        "--file",
        file,
        "--target-db",
        RESTORE_DB,
        "--confirm-target",
        RESTORE_DB,
      ]).status,
    ).toBe(2);
  });

  it("detects a corrupted backup", () => {
    const damaged = join(backupDir, "damaged.dump");
    writeFileSync(damaged, "not a dump");
    writeFileSync(`${damaged}.sha256`, `${"0".repeat(64)}  damaged.dump\n`);
    const verified = ops("backup", ["verify", "--file", damaged]);
    expect(verified.status).toBe(1);
    expect(verified.output).toContain("Checksum mismatch");
  });
});
