import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const ACCESS = "Q7f!x2Lm9$Rt4Vb8Zk1Wn6Ys3Pd5Hg0Jc_aeiouBCDFGHJK";
const REFRESH = "m3N#q8Tz1Xc6Vb4Lp9Rs2Wd7Fh5Kj0Gy_qwertyZXCVBNMA";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://serene:S7rong-db-P4ss@db.internal:5432/serene_management",
  AUTH_ACCESS_TOKEN_SECRET: ACCESS,
  AUTH_REFRESH_TOKEN_SECRET: REFRESH,
  APP_URL: "https://pms.example-hotel.com",
  TRUSTED_PROXY_HOPS: "1",
};

function problems(overrides: Record<string, string | undefined>) {
  const result = parseServerEnv({ ...production, ...overrides });
  return result.success ? "" : result.error;
}

describe("server environment (M6)", () => {
  it("accepts a complete production configuration", () => {
    const result = parseServerEnv(production);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TRUSTED_PROXY_HOPS).toBe(1);
      expect(result.data.AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    }
  });

  it("has no read replica unless READ_DATABASE_URL is set, and validates it", () => {
    const result = parseServerEnv(production);
    expect(result.success && result.data.READ_DATABASE_URL).toBeUndefined();
    if (result.success) {
      expect(result.data.READ_DATABASE_POOL_MAX).toBe(3);
      expect(result.data.READ_REPLICA_MAX_LAG_MS).toBe(30_000);
    }
    expect(problems({ READ_DATABASE_URL: "postgresql://ro:S7rong@replica.internal:5432/db" })).toBe(
      "",
    );
    expect(problems({ READ_DATABASE_URL: "mysql://replica/db" })).toContain("READ_DATABASE_URL");
    expect(problems({ READ_REPLICA_MAX_LAG_MS: "10" })).toContain("READ_REPLICA_MAX_LAG_MS");
    expect(problems({ READ_DATABASE_POOL_MAX: "0" })).toContain("READ_DATABASE_POOL_MAX");
  });

  it("keeps development and test convenient", () => {
    for (const NODE_ENV of ["development", "test"]) {
      const result = parseServerEnv({
        NODE_ENV,
        DATABASE_URL: "postgresql://serene:change-me@localhost:5432/serene_management",
        AUTH_ACCESS_TOKEN_SECRET: "a".repeat(32),
        AUTH_REFRESH_TOKEN_SECRET: "a".repeat(32),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.APP_URL).toBe("http://localhost:3000");
        expect(result.data.TRUSTED_PROXY_HOPS).toBe(0);
      }
    }
  });

  it("rejects missing required variables", () => {
    expect(problems({ DATABASE_URL: undefined })).toContain("DATABASE_URL");
    expect(problems({ AUTH_ACCESS_TOKEN_SECRET: undefined })).toContain("AUTH_ACCESS_TOKEN_SECRET");
    expect(problems({ APP_URL: undefined })).toContain("APP_URL");
    expect(problems({ TRUSTED_PROXY_HOPS: undefined })).toContain("TRUSTED_PROXY_HOPS");
  });

  it("rejects a localhost or non-HTTPS APP_URL in production", () => {
    expect(problems({ APP_URL: "http://localhost:3000" })).toMatch(/localhost/);
    expect(problems({ APP_URL: "https://127.0.0.1" })).toMatch(/localhost/);
    expect(problems({ APP_URL: "http://pms.example-hotel.com" })).toMatch(/https/);
  });

  it("rejects placeholder, weak, shared or short secrets in production", () => {
    expect(problems({ AUTH_ACCESS_TOKEN_SECRET: "change-me-change-me-change-me-12345" })).toMatch(
      /placeholder/,
    );
    expect(problems({ AUTH_ACCESS_TOKEN_SECRET: "ab".repeat(20) })).toMatch(/random/);
    expect(problems({ AUTH_REFRESH_TOKEN_SECRET: ACCESS })).toMatch(/differ/);
    expect(problems({ AUTH_REFRESH_TOKEN_SECRET: "short" })).toContain("AUTH_REFRESH_TOKEN_SECRET");
    expect(
      problems({ DATABASE_URL: "postgresql://serene:change-me@db.internal:5432/serene" }),
    ).toContain("DATABASE_URL");
  });

  it("validates token lifetimes, proxy hops and the field encryption key", () => {
    expect(problems({ AUTH_REFRESH_TOKEN_TTL_SECONDS: String(365 * 86_400) })).toContain(
      "AUTH_REFRESH_TOKEN_TTL_SECONDS",
    );
    expect(
      problems({ AUTH_ACCESS_TOKEN_TTL_SECONDS: "3600", AUTH_REFRESH_TOKEN_TTL_SECONDS: "3600" }),
    ).toMatch(/longer/);
    for (const hops of ["-1", "9", "abc", "1.5"]) {
      expect(problems({ TRUSTED_PROXY_HOPS: hops })).toContain("TRUSTED_PROXY_HOPS");
    }
    expect(problems({ TRUSTED_PROXY_HOPS: "0" })).toBe("");
    expect(problems({ FIELD_ENCRYPTION_KEY: "too-short" })).toContain("FIELD_ENCRYPTION_KEY");
    expect(problems({ FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") })).toBe("");
  });

  it("lets the build phase skip the production-only rules, not the base ones", () => {
    const buildMachine = { ...production, APP_URL: undefined, TRUSTED_PROXY_HOPS: undefined };
    expect(parseServerEnv(buildMachine).success).toBe(false);
    expect(parseServerEnv(buildMachine, { productionRules: false }).success).toBe(true);
    expect(
      parseServerEnv({ ...buildMachine, DATABASE_URL: "mysql://x" }, { productionRules: false })
        .success,
    ).toBe(false);
  });

  it("never echoes secret values in errors", () => {
    const leaked = "change-me-THIS-VALUE-MUST-NOT-APPEAR-9876";
    const message = problems({ AUTH_ACCESS_TOKEN_SECRET: leaked, APP_URL: "http://localhost" });
    expect(message).not.toContain(leaked);
    expect(message).not.toContain(REFRESH);
    expect(message).not.toContain("S7rong-db-P4ss");
  });
});
