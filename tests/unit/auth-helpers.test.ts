import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { lockoutDurationMs } from "@/modules/identity/identity.service";

describe("account lockout schedule", () => {
  it("locks on every 5th consecutive failure, doubling up to 24 hours", () => {
    expect(lockoutDurationMs(4)).toBeNull();
    expect(lockoutDurationMs(5)).toBe(15 * 60_000);
    expect(lockoutDurationMs(6)).toBeNull();
    expect(lockoutDurationMs(10)).toBe(30 * 60_000);
    expect(lockoutDurationMs(15)).toBe(60 * 60_000);
    expect(lockoutDurationMs(100)).toBe(24 * 60 * 60_000);
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
