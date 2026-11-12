import type { RequestHandler } from "express";
import { appError } from "@/lib/customError";
import { type RateLimitRule, consumeRateLimit, rateLimitKey } from "@/lib/rate-limit";

/** Coarse flood guard on writes, before authentication; per-route limits follow per user. */
export const GLOBAL_WRITE_LIMIT: RateLimitRule = {
  name: "api.write.ip",
  limit: 300,
  windowMs: 60_000,
};
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Fixed-window limit (lib/rate-limit.ts): keyed per user when the request is
 * authenticated (`req.ctx`), per client IP otherwise (D44). A request whose IP
 * is unknown is not IP-limited. Rules with `onStoreFailure: "deny"` refuse the
 * request when the shared store is unreachable.
 */
export function rateLimit(rule: RateLimitRule): RequestHandler {
  return async (req, _res, next) => {
    const key = rateLimitKey({ userId: req.ctx?.userId, ipAddress: req.meta.ipAddress });
    if (key !== null) {
      const result = await consumeRateLimit(rule, key);
      if (!result.allowed) {
        throw appError("RATE_LIMITED", "Too many requests. Please wait and try again.", {
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }
    next();
  };
}

/** Global write limit (300/min per IP), mounted once in app.ts. */
export const globalWriteLimit: RequestHandler = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();
  return rateLimit(GLOBAL_WRITE_LIMIT)(req, res, next);
};
