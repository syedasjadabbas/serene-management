import "server-only";

/**
 * Fixed-window rate limiter kept in process memory. Adequate for a single
 * application instance; a multi-instance deployment must swap the store for
 * Redis or PostgreSQL (docs/ARCHITECTURE.md §16, open question 3).
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

export interface RateLimitRule {
  /** Bucket family, e.g. "auth.login.ip". */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function consumeRateLimit(
  rule: RateLimitRule,
  key: string,
  now = Date.now(),
): RateLimitResult {
  sweep(now);
  const id = `${rule.name}:${key}`;
  const current = windows.get(id);
  if (!current || current.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= rule.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

/** Test helper: forget all windows. */
export function resetRateLimits(): void {
  windows.clear();
}

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [id, window] of windows) {
    if (window.resetAt <= now) windows.delete(id);
  }
}
