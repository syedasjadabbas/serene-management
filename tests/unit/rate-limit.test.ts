import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryRateLimitStore,
  type RateLimitStore,
  consumeRateLimit,
  rateLimitKey,
  resetRateLimits,
  setRateLimitStore,
} from "@/lib/http/rate-limit";

const rule = { name: "test.write", limit: 2, windowMs: 60_000 };

describe("rate limiting (G11)", () => {
  afterEach(async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    await resetRateLimits();
  });

  it("keys authenticated requests by user and anonymous ones by the trusted IP", () => {
    expect(rateLimitKey({ userId: "u1", ipAddress: "10.0.0.1" })).toBe("user:u1");
    expect(rateLimitKey({ ipAddress: "10.0.0.1" })).toBe("ip:10.0.0.1");
    // Unknown IP: no shared "unknown" bucket that one client could exhaust for all (H2).
    expect(rateLimitKey({ ipAddress: null })).toBeNull();
  });

  it("bounds the number of tracked windows, evicting expired then oldest", async () => {
    const small = new MemoryRateLimitStore(3);
    for (const id of ["a", "b", "c", "d", "e"]) await small.hit(id, 60_000, 1_000);
    expect(small.size).toBe(3);
    // The most recent keys survive; "a" and "b" were evicted.
    expect((await small.hit("e", 60_000, 1_000)).count).toBe(2);
    expect((await small.hit("a", 60_000, 1_000)).count).toBe(1);
  });

  it("limits each key within its window and gives a retry delay", async () => {
    const now = 1_000_000;
    const a = rateLimitKey({ userId: "a", ipAddress: "10.0.0.1" })!;
    const b = rateLimitKey({ userId: "b", ipAddress: "10.0.0.1" })!;
    expect((await consumeRateLimit(rule, a, now)).allowed).toBe(true);
    expect((await consumeRateLimit(rule, a, now)).allowed).toBe(true);
    const third = await consumeRateLimit(rule, a, now + 1_000);
    expect(third).toEqual({ allowed: false, retryAfterSeconds: 59 });
    // A colleague behind the same IP keeps their own bucket.
    expect((await consumeRateLimit(rule, b, now)).allowed).toBe(true);
    // The window resets.
    expect((await consumeRateLimit(rule, a, now + 60_000)).allowed).toBe(true);
  });

  it("uses the registered store", async () => {
    const seen: string[] = [];
    const store: RateLimitStore = {
      async hit(id, windowMs, now) {
        seen.push(id);
        return { count: 1, resetAt: now + windowMs };
      },
      async clear() {},
    };
    setRateLimitStore(store);
    await consumeRateLimit(rule, "user:x");
    expect(seen).toEqual(["test.write:user:x"]);
  });
});
