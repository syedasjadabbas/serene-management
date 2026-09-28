import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { hasPermission, hasPermissionAnywhere } from "@/lib/permissions/evaluate";
import { auditLogQuerySchema } from "@/modules/audit/audit.schema";
import { listPropertyAuditLogs } from "@/modules/audit/audit.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "audit:read",
  params: propertyParamsSchema,
  query: auditLogQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listPropertyAuditLogs(
      ctx.organizationId,
      ctx.propertyId,
      query,
      hasPermission(ctx.access, ctx.propertyId, "billing:read"),
      hasPermissionAnywhere(ctx.access, "guests:read"),
    );
    return withMeta(items, meta);
  },
});
