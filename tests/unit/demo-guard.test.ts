import { describe, expect, it } from "vitest";
import { DemoSeedRefused, demoSeedDecision } from "@/prisma/seed/demo-guard";

const STRONG = "Vx7!pQ2m-Rk9#Lt4w";

describe("demo seed guard (M7)", () => {
  it("does nothing unless SEED_DEMO=true", () => {
    expect(demoSeedDecision({})).toEqual({ run: false });
    expect(demoSeedDecision({ SEED_DEMO: "1", NODE_ENV: "production" })).toEqual({ run: false });
  });

  it("refuses production outright, with no override", () => {
    for (const extra of [{}, { SEED_DEMO_FORCE: "true" }, { ALLOW_DEMO_IN_PRODUCTION: "yes" }]) {
      expect(() =>
        demoSeedDecision({
          SEED_DEMO: "true",
          NODE_ENV: "production",
          SEED_DEMO_PASSWORD: STRONG,
          ...extra,
        }),
      ).toThrow(DemoSeedRefused);
    }
  });

  it("requires a strong, explicit demo password instead of a shared default", () => {
    const base = { SEED_DEMO: "true", NODE_ENV: "development" };
    expect(() => demoSeedDecision(base)).toThrow(/SEED_DEMO_PASSWORD/);
    for (const weak of ["short", "password", "aaaaaaaaaaaaaaaaaaaa", "change-me"]) {
      expect(() => demoSeedDecision({ ...base, SEED_DEMO_PASSWORD: weak })).toThrow(
        DemoSeedRefused,
      );
    }
    expect(demoSeedDecision({ ...base, SEED_DEMO_PASSWORD: STRONG })).toEqual({
      run: true,
      password: STRONG,
    });
  });

  it("never includes the password in its messages", () => {
    try {
      demoSeedDecision({ SEED_DEMO: "true", NODE_ENV: "production", SEED_DEMO_PASSWORD: STRONG });
    } catch (error) {
      expect(String(error)).not.toContain(STRONG);
    }
  });
});
