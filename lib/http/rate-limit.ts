import "server-only";
import { prisma } from "@/lib/db/prisma";
import { PostgresRateLimitStore } from "@/lib/db/rate-limit-store";
import { serverEnv } from "@/lib/env";
import { counter } from "@/lib/observability/metrics";
import { AppError } from "./errors";
import { logServerError } from "./log";

/**
 * Fixed-window rate limiting behind a store abstraction (G11). Production uses
 * the PostgreSQL store (lib/db/rate-limit-store.ts): every application
 * instance counts in the same windows, so limits do not multiply with the
 * number of instances (scalability phase 2, docs/SCALABILITY.md §26).
 * `RATE_LIMIT_STORE=memory` keeps windows in process memory, which is only
 * correct for a single instance (unit tests, local experiments).
 *
 * Keys are chosen by the caller: authenticated requests are limited per user
 * (colleagues behind one hotel NAT do not share a bucket), anonymous ones
 * per client IP.
 */

export interface RateLimitRule {
  /** Bucket family, e.g. "auth.login.ip" or "billing.write". */
  name: string;
  limit: number;
  windowMs: number;
  /**
   * When the shared store cannot be reached: "deny" refuses the request
   * (security limits: sign-in, password reset and change, token refresh);
   * "allow" (default) serves it unlimited and logs, so an abuse brake never
   * takes the application down with it.
   */
  onStoreFailure?: "deny" | "allow";
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  /** Counts one hit in the window of `id` and returns the window's state after it. */
  hit(id: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
  /** Forgets every window (tests). */
  clear(): Promise<void>;
}

/** Upper bound of tracked windows, so key churn cannot grow memory without limit. */
export const MAX_TRACKED_WINDOWS = 100_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly maxWindows = MAX_TRACKED_WINDOWS) {}

  async hit(id: string, windowMs: number, now: number) {
    this.sweep(now);
    const current = this.windows.get(id);
    if (!current || current.resetAt <= now) {
      if (current) this.windows.delete(id);
      this.evictIfFull(now);
      const fresh = { count: 1, resetAt: now + windowMs };
      this.windows.set(id, fresh);
      return { ...fresh };
    }
    current.count += 1;
    return { ...current };
  }

  async clear() {
    this.windows.clear();
  }

  get size(): number {
    return this.windows.size;
  }

  /** Drops expired windows, then the oldest ones (Map keeps insertion order). */
  private evictIfFull(now: number) {
    if (this.windows.size < this.maxWindows) return;
    for (const [id, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(id);
    }
    for (const id of this.windows.keys()) {
      if (this.windows.size < this.maxWindows) break;
      this.windows.delete(id);
    }
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [id, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(id);
    }
  }
}

let store: RateLimitStore | null = null;

function currentStore(): RateLimitStore {
  store ??=
    serverEnv().RATE_LIMIT_STORE === "memory"
      ? new MemoryRateLimitStore()
      : new PostgresRateLimitStore(prisma);
  return store;
}

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/** Last failure log per rule: one line per minute, not one per request. */
const lastFailureLog = new Map<string, number>();

/**
 * Bucket key of a request: the user when authenticated, otherwise the
 * trusted client IP (D44). Null when neither is known: such requests are not
 * IP-limited rather than all sharing one global bucket that any client could
 * exhaust for everyone (login still has its per-account limit).
 */
export function rateLimitKey(subject: {
  userId?: string | null;
  ipAddress: string | null;
}): string | null {
  if (subject.userId) return `user:${subject.userId}`;
  return subject.ipAddress ? `ip:${subject.ipAddress}` : null;
}

export async function consumeRateLimit(
  rule: RateLimitRule,
  key: string,
  now = Date.now(),
): Promise<RateLimitResult> {
  let window: { count: number; resetAt: number };
  try {
    window = await currentStore().hit(`${rule.name}:${key}`, rule.windowMs, now);
  } catch (error) {
    counter(
      "rate_limit_store_errors_total",
      "Rate-limit store failures by rule and the policy applied (allow or deny)",
    ).inc({ rule: rule.name, policy: rule.onStoreFailure === "deny" ? "deny" : "allow" });
    if (now - (lastFailureLog.get(rule.name) ?? 0) >= 60_000) {
      lastFailureLog.set(rule.name, now);
      logServerError(`rate-limit:${rule.name}`, error);
    }
    if (rule.onStoreFailure === "deny") {
      throw new AppError(
        "INTERNAL_ERROR",
        "This is temporarily unavailable. Please try again shortly.",
      );
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (window.count > rule.limit) {
    counter("rate_limit_rejections_total", "Requests refused with 429 by rate-limit rule").inc({
      rule: rule.name,
    });
  }
  return {
    allowed: window.count <= rule.limit,
    retryAfterSeconds:
      window.count <= rule.limit ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
  };
}

/** Test helper: forget all windows. */
export async function resetRateLimits(): Promise<void> {
  await currentStore().clear();
}
