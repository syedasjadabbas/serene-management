import "server-only";

/**
 * Fixed-window rate limiting behind a store abstraction (G11). The default
 * store keeps windows in process memory, which is adequate for the single
 * application instance we run; a multi-instance deployment registers a
 * shared store (PostgreSQL or Redis) with `setRateLimitStore` without
 * touching the callers (docs/ARCHITECTURE.md D39).
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

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  async hit(id: string, windowMs: number, now: number) {
    this.sweep(now);
    const current = this.windows.get(id);
    if (!current || current.resetAt <= now) {
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

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [id, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(id);
    }
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/** Bucket key of a request: the user when authenticated, otherwise the client IP. */
export function rateLimitKey(subject: { userId?: string | null; ipAddress: string | null }) {
  return subject.userId ? `user:${subject.userId}` : `ip:${subject.ipAddress ?? "unknown"}`;
}

export async function consumeRateLimit(
  rule: RateLimitRule,
  key: string,
  now = Date.now(),
): Promise<RateLimitResult> {
  const window = await store.hit(`${rule.name}:${key}`, rule.windowMs, now);
  return {
    allowed: window.count <= rule.limit,
    retryAfterSeconds:
      window.count <= rule.limit ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
  };
}

/** Test helper: forget all windows. */
export async function resetRateLimits(): Promise<void> {
  await store.clear();
}
