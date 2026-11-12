import type { RequestHandler } from "express";
import { forbidden } from "@/lib/customError";
import type { PropertyContext } from "@/lib/context";
import type { Permission } from "@serene/shared/lib/permissions/catalog";
import { hasOrganizationPermission, hasPermission } from "@serene/shared/lib/permissions/evaluate";

/** Property-scope permission: mount behind `propertyScope`. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const propertyId = (req.ctx as PropertyContext).propertyId;
    if (!propertyId || !hasPermission(req.ctx.access, propertyId, permission)) {
      throw forbidden(permission);
    }
    next();
  };
}

/** Organization-scope permission: mount behind `requireAuth` (organization-level routes). */
export function requireOrgPermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!hasOrganizationPermission(req.ctx.access, permission)) throw forbidden(permission);
    next();
  };
}
