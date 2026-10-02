import { describe, expect, it } from "vitest";
import { POOL_IDLE_TIMEOUT_MS, connectionBudget, pgPoolConfig } from "@/lib/db/pool-config";
import { parseServerEnv } from "@/lib/env";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://serene:pw@localhost:5432/serene_management",
  AUTH_ACCESS_TOKEN_SECRET: "a".repeat(32),
  AUTH_REFRESH_TOKEN_SECRET: "b".repeat(32),
};

function env(overrides: Record<string, string | undefined> = {}) {
  const parsed = parseServerEnv({ ...base, ...overrides });
  if (!parsed.success) throw new Error(parsed.error);
  return parsed.data;
}

describe("database pool configuration (M19)", () => {
  it("uses explicit, conservative defaults", () => {
    const config = pgPoolConfig(env());
    expect(config).toMatchObject({
      connectionString: base.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      application_name: "serene-management",
    });
    expect(config.options).toBe(
      "-c TimeZone=UTC -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
    );
  });

  it("keeps every session in UTC whatever else is configured (D29)", () => {
    const config = pgPoolConfig(
      env({
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_MS: "2000",
        DATABASE_STATEMENT_TIMEOUT_MS: "15000",
        DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: "120000",
      }),
    );
    expect(config.max).toBe(4);
    expect(config.connectionTimeoutMillis).toBe(2_000);
    expect(config.options).toContain("-c TimeZone=UTC");
    expect(config.options).toContain("-c statement_timeout=15000");
    expect(config.options).toContain("-c idle_in_transaction_session_timeout=120000");
  });

  it("rejects unsafe or malformed values", () => {
    for (const [name, value] of [
      ["DATABASE_POOL_MAX", "0"],
      ["DATABASE_POOL_MAX", "500"],
      ["DATABASE_POOL_MAX", "ten"],
      ["DATABASE_CONNECT_TIMEOUT_MS", "0"],
      ["DATABASE_STATEMENT_TIMEOUT_MS", "0"],
      ["DATABASE_STATEMENT_TIMEOUT_MS", "999999999"],
      ["DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS", "10"],
      ["MIGRATION_DATABASE_URL", "mysql://root@localhost/x"],
    ] as const) {
      const parsed = parseServerEnv({ ...base, [name]: value });
      expect(parsed.success, `${name}=${value}`).toBe(false);
      if (!parsed.success) expect(parsed.error).toContain(name);
    }
  });

  it("passes the pool size, idle timeout and connection lifetime settings (D64)", () => {
    const config = pgPoolConfig(
      env({
        DATABASE_POOL_MAX: "8",
        DATABASE_POOL_MIN: "2",
        DATABASE_POOL_IDLE_TIMEOUT_MS: "120000",
        DATABASE_POOL_MAX_LIFETIME_S: "1800",
      }),
    );
    expect(config).toMatchObject({
      max: 8,
      min: 2,
      idleTimeoutMillis: 120_000,
      maxLifetimeSeconds: 1800,
    });
  });

  it("sends no startup options through a transaction-mode PgBouncer (set them on the role)", () => {
    const config = pgPoolConfig(
      env({
        DATABASE_POOLER: "pgbouncer-transaction",
        REALTIME_DATABASE_URL: "postgresql://serene:pw@db-direct:5432/serene_management",
      }),
    );
    expect(config.options).toBeUndefined();
    expect(config.application_name).toBe("serene-management");
  });

  it("requires a direct LISTEN connection behind a transaction pooler, and min ≤ max", () => {
    const pooled = parseServerEnv({ ...base, DATABASE_POOLER: "pgbouncer-transaction" });
    expect(pooled.success).toBe(false);
    if (!pooled.success) expect(pooled.error).toContain("REALTIME_DATABASE_URL");
    // Without live updates there is no LISTEN connection to protect.
    expect(
      parseServerEnv({ ...base, DATABASE_POOLER: "pgbouncer-transaction", REALTIME_ENABLED: "0" })
        .success,
    ).toBe(true);
    const inverted = parseServerEnv({ ...base, DATABASE_POOL_MAX: "4", DATABASE_POOL_MIN: "5" });
    expect(inverted.success).toBe(false);
    if (!inverted.success) expect(inverted.error).toContain("DATABASE_POOL_MIN");
    for (const [name, value] of [
      ["DATABASE_POOL_IDLE_TIMEOUT_MS", "10"],
      ["DATABASE_POOL_MAX_LIFETIME_S", "-1"],
      ["DATABASE_POOLER", "pgpool"],
    ] as const) {
      expect(parseServerEnv({ ...base, [name]: value }).success, `${name}=${value}`).toBe(false);
    }
  });

  it("never leaks the connection password into the session options", () => {
    const config = pgPoolConfig(env({ DATABASE_URL: "postgresql://serene:S3cret-Pw@db:5432/x" }));
    expect(config.options).not.toContain("S3cret-Pw");
  });
});

describe("connection budget (scalability phase 9)", () => {
  const pg100 = { maxConnections: 100, superuserReserved: 3 };

  it("counts the inline worker's own pool and both LISTEN connections", () => {
    // 100 − 3 − 10 = 87 usable; 10 + 1 realtime + (10 + 1) worker = 22 per instance.
    expect(connectionBudget({ ...pg100, poolMax: 10, realtime: true, inlineWorker: true })).toEqual(
      { usable: 87, perInstance: 22, perWorkerProcess: 11, workers: 0, instances: 2 },
    );
  });

  it("fits more web instances when jobs run in separate worker processes", () => {
    const budget = connectionBudget({
      ...pg100,
      poolMax: 10,
      realtime: true,
      inlineWorker: false,
      workerProcesses: 1,
    });
    // (87 − 11) / 11 = 6, minus one surge instance for rolling updates.
    expect(budget).toMatchObject({ perInstance: 11, workers: 11, instances: 5 });
  });

  it("keeps the rolling-update surge and never goes negative", () => {
    const tight = { ...pg100, maxConnections: 30, poolMax: 10, realtime: true, inlineWorker: true };
    expect(connectionBudget(tight).instances).toBe(0);
    expect(
      connectionBudget({ ...pg100, poolMax: 5, realtime: true, inlineWorker: false, surge: 0 }),
    ).toMatchObject({ perInstance: 6, instances: 14 });
  });
});
