import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { auditLogQuerySchema } from "@/modules/audit/audit.schema";
import { listPropertyAuditLogs } from "@/modules/audit/audit.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "audit:read",
  params: propertyParamsSchema,
  query: auditLogQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listPropertyAuditLogs(ctx.organizationId, ctx.propertyId, query);
    return withMeta(items, meta);
  },
});
