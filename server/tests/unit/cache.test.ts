import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_MAX_TTL_MS,
  cacheBackend,
  cacheDel,
  cacheDelPrefix,
  cacheGet,
  cacheSet,
  clearMemoryCache,
  swr,
} from "@/lib/cache";
import { AppError, appError, forbidden, notFound } from "@/lib/customError";
import { normalizeError } from "@/lib/response";

beforeEach(() => {
  clearMemoryCache();
  vi.useRealTimers();
});

describe("cache (memory fallback, no REDIS_URL)", () => {
  it("falls back to memory when Redis is not configured", () => {
    expect(cacheBackend()).toBe("memory");
  });

  it("stores JSON values with a TTL capped for memory", async () => {
    await cacheSet("k", { a: 1 }, 50);
    expect(await cacheGet("k")).toEqual({ a: 1 });
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(await cacheGet("k")).toBeUndefined();
    expect(MEMORY_MAX_TTL_MS).toBe(10_000);
  });

  it("deletes single keys and prefixes", async () => {
    await cacheSet("sess:u1:a", 1, 5_000);
    await cacheSet("sess:u1:b", 2, 5_000);
    await cacheSet("sess:u2:a", 3, 5_000);
    await cacheDel("sess:u1:a");
    expect(await cacheGet("sess:u1:a")).toBeUndefined();
    await cacheDelPrefix("sess:u1:");
    expect(await cacheGet("sess:u1:b")).toBeUndefined();
    expect(await cacheGet("sess:u2:a")).toBe(3);
  });
});

describe("swr", () => {
  it("loads once for concurrent callers (single flight) and then serves from cache", async () => {
    const loader = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "value";
    });
    const results = await Promise.all([1, 2, 3].map(() => swr("flight", 1_000, loader)));
    expect(results).toEqual(["value", "value", "value"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await swr("flight", 1_000, loader)).toBe("value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves a stale value at once and refreshes in the background", async () => {
    let n = 0;
    const loader = vi.fn(async () => ++n);
    expect(await swr("stale", 20, loader, 5_000)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await swr("stale", 20, loader, 5_000)).toBe(1); // stale, refresh started
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await swr("stale", 20, loader, 5_000)).toBe(2);
  });

  it("keeps the stale value when the background refresh fails", async () => {
    let fail = false;
    const loader = async () => {
      if (fail) throw new Error("db down");
      return "ok";
    };
    expect(await swr("keep", 10, loader, 5_000)).toBe("ok");
    fail = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await swr("keep", 10, loader, 5_000)).toBe("ok");
  });
});

describe("AppError", () => {
  it("maps codes to statuses and keeps the factory messages", () => {
    const error = appError("BUSINESS_RULE_VIOLATION", "no", { a: 1 });
    expect(error).toBeInstanceOf(AppError);
    expect([error.status, error.code, error.isOperational, error.details]).toEqual([
      422,
      "BUSINESS_RULE_VIOLATION",
      true,
      { a: 1 },
    ]);
    expect(notFound("Guest")).toMatchObject({ status: 404, message: "Guest not found" });
    expect(forbidden("x:y").details).toEqual({ permission: "x:y" });
  });

  it("answers unknown errors as a non-operational INTERNAL_ERROR", () => {
    const error = normalizeError(new Error("boom"));
    expect([error.status, error.code, error.isOperational]).toEqual([500, "INTERNAL_ERROR", false]);
  });
});
