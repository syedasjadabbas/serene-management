import type { RequestHandler } from "express";
import { appError } from "@/lib/customError";
import { type Permission, isHighRisk } from "@serene/shared/lib/permissions/catalog";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * High-risk permissions demand a written reason on state-changing requests
 * (docs/RBAC.md section 2). Mount after `validateBody`, so `req.body` is parsed.
 */
export function requireReasonForHighRisk(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!isHighRisk(permission) || !MUTATING.has(req.method)) return next();
    const reason = (req.body as { reason?: unknown } | undefined)?.reason;
    if (typeof reason !== "string" || reason.trim().length < 3) {
      throw appError("VALIDATION_FAILED", "A reason is required for this action", {
        fields: { reason: ["A reason is required for this action"] },
      });
    }
    next();
  };
}
