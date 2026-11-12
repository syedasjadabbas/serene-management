import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { appError } from "@/lib/customError";
import type { IdempotencyRequest } from "@/lib/context";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;

/**
 * Reads the client's `Idempotency-Key` and fingerprints the request (method,
 * path and the validated body), so a key reused for a different request is
 * detected instead of replaying the wrong response. Mount after
 * `validateBody`. Sets `req.idempotency`.
 *
 *  - `required: true`  financial commands: the header is mandatory (400 otherwise).
 *  - `required: false` bookings: a key is honoured when sent; `req.idempotency`
 *    is null otherwise.
 */
export function idempotency(options: { required: boolean }): RequestHandler {
  return (req, _res, next) => {
    if (!options.required && !req.get("idempotency-key")) {
      req.idempotency = null;
      return next();
    }
    const key = req.get("idempotency-key")?.trim() ?? "";
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw appError(
        "VALIDATION_FAILED",
        "An Idempotency-Key header (16-80 letters, digits, '-' or '_') is required",
        { fields: { "Idempotency-Key": ["Missing or invalid"] } },
      );
    }
    const route = `${req.method} ${req.originalUrl.split("?")[0]}`.slice(0, 200);
    const requestHash = createHash("sha256")
      .update(`${route} ${JSON.stringify(req.body ?? null)}`)
      .digest("hex");
    const value: IdempotencyRequest = { key, route, requestHash };
    req.idempotency = value;
    next();
  };
}
