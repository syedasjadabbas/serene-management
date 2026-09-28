import { describe, expect, it } from "vitest";
import { POOL_IDLE_TIMEOUT_MS, pgPoolConfig } from "@/lib/db/pool-config";
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

  it("never leaks the connection password into the session options", () => {
    const config = pgPoolConfig(env({ DATABASE_URL: "postgresql://serene:S3cret-Pw@db:5432/x" }));
    expect(config.options).not.toContain("S3cret-Pw");
  });
});
