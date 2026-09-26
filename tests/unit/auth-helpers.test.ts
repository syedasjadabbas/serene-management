import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import {
  effectiveFailureCount,
  lockoutDurationMs,
  sessionPredatesPasswordChange,
} from "@/modules/identity/identity.service";

describe("account lockout schedule (H5, D45)", () => {
  it("locks on every 5th consecutive failure, doubling up to one hour", () => {
    expect(lockoutDurationMs(4)).toBeNull();
    expect(lockoutDurationMs(5)).toBe(15 * 60_000);
    expect(lockoutDurationMs(6)).toBeNull();
    expect(lockoutDurationMs(10)).toBe(30 * 60_000);
    expect(lockoutDurationMs(15)).toBe(60 * 60_000);
    // Capped: an attacker who only knows the email cannot lock a user out for days.
    expect(lockoutDurationMs(100)).toBe(60 * 60_000);
    expect(lockoutDurationMs(1_000_000)).toBe(60 * 60_000);
  });

  it("forgets failures once the last lock ended more than a day ago", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(effectiveFailureCount(10, new Date("2026-09-29T12:00:00Z"), now)).toBe(0);
    expect(effectiveFailureCount(10, new Date("2026-10-01T11:00:00Z"), now)).toBe(10);
    expect(effectiveFailureCount(3, null, now)).toBe(3);
  });
});

describe("password change invalidates older sessions (H4)", () => {
  it("rejects a session opened before the current password was set", () => {
    const changed = new Date("2026-10-01T12:00:00Z");
    expect(sessionPredatesPasswordChange(new Date("2026-10-01T11:59:59Z"), changed)).toBe(true);
    expect(sessionPredatesPasswordChange(changed, changed)).toBe(false);
    expect(sessionPredatesPasswordChange(new Date("2026-10-01T12:00:01Z"), changed)).toBe(false);
    expect(sessionPredatesPasswordChange(new Date(0), null)).toBe(false);
  });
});

describe("post-login redirect", () => {
  it("accepts same-origin paths only", () => {
    expect(safeNextPath("/SMR?tab=1")).toBe("/SMR?tab=1");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example/x")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/SMR\u0000")).toBe("/");
    expect(safeNextPath("/api/v1/me")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("pagination cursor", () => {
  it("round-trips and rejects garbage", () => {
    const cursor = encodeCursor({ c: "2026-09-24T10:00:00.000Z", i: "abc" });
    expect(decodeCursor(cursor, ["c", "i"] as const)).toEqual({
      c: "2026-09-24T10:00:00.000Z",
      i: "abc",
    });
    expect(decodeCursor("garbage", ["c", "i"] as const)).toBeNull();
    expect(decodeCursor(encodeCursor({ c: "x" }), ["c", "i"] as const)).toBeNull();
  });
});
