import { describe, expect, it } from "vitest";
import { jobWorkerOff } from "@/lib/jobs/switch";
import {
  OpsRefused,
  assertDatabase,
  databaseGuard,
  expectedDatabase,
  resolveWriteMode,
} from "@/scripts/ops/db-guard";

describe("ops write mode (dry-run by default)", () => {
  it("is a dry run with no flags and with the --dry-run alias", () => {
    expect(resolveWriteMode({})).toEqual({ apply: false });
    expect(resolveWriteMode({ "dry-run": true })).toEqual({ apply: false });
  });

  it("writes only with both --apply and --yes", () => {
    expect(resolveWriteMode({ apply: true, yes: true })).toEqual({ apply: true });
  });

  it("refuses half of the pair and a contradiction instead of guessing", () => {
    expect(() => resolveWriteMode({ apply: true })).toThrow(OpsRefused);
    expect(() => resolveWriteMode({ yes: true })).toThrow(OpsRefused);
    expect(() => resolveWriteMode({ "dry-run": true, apply: true, yes: true })).toThrow(OpsRefused);
  });
});

describe("ops database guard", () => {
  it("takes --database before OPS_EXPECTED_DATABASE and ignores blanks", () => {
    expect(expectedDatabase("a", { OPS_EXPECTED_DATABASE: "b" })).toBe("a");
    expect(expectedDatabase(undefined, { OPS_EXPECTED_DATABASE: " b " })).toBe("b");
    expect(expectedDatabase("  ", {})).toBeUndefined();
  });

  it("requires the expected name to write, and it must match", () => {
    expect(databaseGuard({ apply: true, actual: "serene" })).toMatch(/without --database/);
    expect(databaseGuard({ apply: true, actual: "serene", expected: "other" })).toMatch(
      /expected database "other" but connected to "serene"/,
    );
    expect(databaseGuard({ apply: true, actual: "serene", expected: "serene" })).toBeNull();
  });

  it("lets a dry run proceed without a name but still rejects a wrong one", () => {
    expect(databaseGuard({ apply: false, actual: "serene" })).toBeNull();
    expect(databaseGuard({ apply: false, actual: "serene", expected: "x" })).not.toBeNull();
  });

  it("refuses to write a _test database in production only", () => {
    const input = { apply: true, actual: "serene_test", expected: "serene_test" };
    expect(databaseGuard({ ...input, nodeEnv: "production" })).toMatch(/_test/);
    expect(databaseGuard({ ...input, nodeEnv: "development" })).toBeNull();
    expect(databaseGuard({ ...input, apply: false, nodeEnv: "production" })).toBeNull();
  });

  it("assertDatabase throws OpsRefused", () => {
    expect(() => assertDatabase({ apply: true, actual: "a", expected: "b" })).toThrow(OpsRefused);
  });
});

describe("job worker kill switch", () => {
  it("is on only for JOB_WORKER=off", () => {
    expect(jobWorkerOff("off")).toBe(true);
    expect(jobWorkerOff(" OFF ")).toBe(true);
    expect(jobWorkerOff("inline")).toBe(false);
    expect(jobWorkerOff(undefined)).toBe(false);
  });
});
