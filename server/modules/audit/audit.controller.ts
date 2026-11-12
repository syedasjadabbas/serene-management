import { handle, handleProperty, withMeta } from "@/lib/controller";
import { hasPermission, hasPermissionAnywhere } from "@serene/shared/lib/permissions/evaluate";
import * as service from "./audit.service";

/** Organization audit trail; the service limits rows to the caller's audit scope. */
export const listOrganization = handle(async (req, res) => {
  const { items, meta } = await service.listOrganizationAuditLogs(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

export const listProperty = handleProperty(async (req, res) => {
  const { ctx } = req;
  const { items, meta } = await service.listPropertyAuditLogs(
    ctx.organizationId,
    ctx.propertyId,
    res.locals.query,
    hasPermission(ctx.access, ctx.propertyId, "billing:read"),
    hasPermissionAnywhere(ctx.access, "guests:read"),
  );
  return withMeta(items, meta);
});
