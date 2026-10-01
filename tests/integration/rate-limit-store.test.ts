import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { pgPoolConfig } from "@/lib/db/pool-config";
import { PostgresRateLimitStore } from "@/lib/db/rate-limit-store";
import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/http/errors";
import {
  MemoryRateLimitStore,
  type RateLimitRule,
  consumeRateLimit,
  setRateLimitStore,
} from "@/lib/http/rate-limit";
import { LOGIN_ACCOUNT_LIMIT } from "@/modules/identity/identity.service";
import { call } from "./support/http";

/**
 * Shared rate limiting (scalability phase 2, docs/SCALABILITY.md §26). Each
 * "instance" here is a separate PrismaClient with its own connection pool and
 * its own store object — nothing in process memory is shared between them, as
 * between two application processes. Only PostgreSQL is.
 */

const clients: PrismaClient[] = [];
let instanceA: PostgresRateLimitStore;
let instanceB: PostgresRateLimitStore;

function newInstance(overrides: Partial<ReturnType<typeof serverEnv>> = {}) {
  const client = new PrismaClient({
    adapter: new PrismaPg(pgPoolConfig({ ...serverEnv(), ...overrides })),
  });
  clients.push(client);
  return new PostgresRateLimitStore(client);
}

const uniqueKey = (label: string) => `${label}:${randomUUID()}`;
const rule = (limit: number, windowMs = 60_000): RateLimitRule => ({
  name: `test.shared.${randomUUID().slice(0, 8)}`,
  limit,
  windowMs,
});

async function consumeOn(
  store: PostgresRateLimitStore,
  r: RateLimitRule,
  key: string,
  now?: number,
) {
  setRateLimitStore(store);
  return consumeRateLimit(r, key, now);
}

beforeAll(() => {
  instanceA = newInstance();
  instanceB = newInstance();
});

afterAll(async () => {
  setRateLimitStore(new PostgresRateLimitStore(prisma));
  await Promise.all(clients.map((c) => c.$disconnect()));
});

describe("one budget across instances", () => {
  it("shares the count between instances; switching instance never resets it", async () => {
    const r = rule(5);
    const key = uniqueKey("user");
    const now = Date.now();
    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push((await consumeOn(i % 2 === 0 ? instanceA : instanceB, r, key, now)).allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false, false, false]);
    // A brand-new instance (fresh process) sees the same exhausted budget.
    expect((await consumeOn(newInstance(), r, key, now)).allowed).toBe(false);
  });

  it("is the failure mode it replaces: separate memory stores each allow the full limit", async () => {
    const r = rule(5);
    const key = uniqueKey("user");
    const memoryA = new MemoryRateLimitStore();
    const memoryB = new MemoryRateLimitStore();
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      setRateLimitStore(i % 2 === 0 ? memoryA : memoryB);
      if ((await consumeRateLimit(r, key)).allowed) allowed++;
    }
    expect(allowed).toBe(10); // twice the limit with two instances
  });

  it("restarts the window after it ends, and reports the remaining wait", async () => {
    const r = rule(2, 60_000);
    const key = uniqueKey("ip");
    const t0 = Date.now();
    expect((await consumeOn(instanceA, r, key, t0)).allowed).toBe(true);
    expect((await consumeOn(instanceB, r, key, t0 + 1_000)).allowed).toBe(true);
    expect(await consumeOn(instanceA, r, key, t0 + 20_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
    // At the end of the window (from either instance) the count starts again.
    expect(await consumeOn(instanceB, r, key, t0 + 60_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect((await instanceA.hit(`${r.name}:${key}`, r.windowMs, t0 + 60_001)).count).toBe(2);
  });

  it("keeps separate buckets per key and per rule", async () => {
    const r = rule(1);
    const other = rule(1);
    const a = uniqueKey("user");
    const b = uniqueKey("user");
    expect((await consumeOn(instanceA, r, a)).allowed).toBe(true);
    expect((await consumeOn(instanceB, r, a)).allowed).toBe(false);
    expect((await consumeOn(instanceB, r, b)).allowed).toBe(true);
    expect((await consumeOn(instanceA, other, a)).allowed).toBe(true);
  });

  it("stores over-long keys under a hash, still one bucket", async () => {
    const r = rule(1);
    const key = `email:${"x".repeat(600)}@example.test`;
    expect((await consumeOn(instanceA, r, key)).allowed).toBe(true);
    expect((await consumeOn(instanceB, r, key)).allowed).toBe(false);
  });
});

describe("atomicity under concurrent bursts", () => {
  it("gives every concurrent hit a distinct count across instances", async () => {
    const id = `${rule(1).name}:${uniqueKey("burst")}`;
    const now = Date.now();
    const hits = await Promise.all(
      Array.from({ length: 120 }, (_, i) =>
        (i % 2 === 0 ? instanceA : instanceB).hit(id, 60_000, now),
      ),
    );
    const counts = hits.map((h) => h.count).sort((x, y) => x - y);
    expect(counts).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(new Set(hits.map((h) => h.resetAt)).size).toBe(1);
  });

  it("admits exactly the limit from a concurrent burst through both instances", async () => {
    const r = rule(10);
    const key = uniqueKey("burst");
    const now = Date.now();
    const both = [instanceA, instanceB];
    // consumeRateLimit reads the registered store, so each "instance" hits its store directly.
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        both[i % 2]!.hit(`${r.name}:${key}`, r.windowMs, now).then((w) => w.count <= r.limit),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });
});

describe("failure behaviour with the database unreachable", () => {
  it("fails closed for security limits and open for the others", async () => {
    const url = new URL(serverEnv().DATABASE_URL);
    url.port = "1"; // nothing listens there
    const unreachable = newInstance({
      DATABASE_URL: url.toString(),
      DATABASE_CONNECT_TIMEOUT_MS: 1_000,
    });
    setRateLimitStore(unreachable);
    const denied = await consumeRateLimit(
      { ...rule(5), onStoreFailure: "deny" },
      uniqueKey("email"),
    ).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(AppError);
    expect((denied as AppError).code).toBe("INTERNAL_ERROR");
    expect(await consumeRateLimit(rule(5), uniqueKey("user"))).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  }, 20_000);
});

describe("sign-in protection across instances", () => {
  it("keeps counting an account's attempts when requests move between instances", async () => {
    const email = `nobody.${randomUUID().slice(0, 8)}@serene.test`;
    const attempt = (ip: string) =>
      call(loginRoute, {
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email, password: "Wrong-password-123" },
        ip,
      });
    const statuses: number[] = [];
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT.limit + 2; i++) {
      // Alternate the instance and the client address: neither resets the budget.
      setRateLimitStore(i % 2 === 0 ? instanceA : instanceB);
      statuses.push((await attempt(`203.0.113.${(i % 200) + 1}`)).status);
    }
    expect(statuses.slice(0, LOGIN_ACCOUNT_LIMIT.limit).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(LOGIN_ACCOUNT_LIMIT.limit)).toEqual([429, 429]);
  }, 60_000);
});
