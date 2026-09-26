import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { organizationAuditLogQuerySchema } from "@/modules/audit/audit.schema";
import { listOrganizationAuditLogs } from "@/modules/audit/audit.service";

/** Organization audit trail; the service limits rows to the caller's audit scope (G3). */
export const GET = defineSessionRoute({
  query: organizationAuditLogQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listOrganizationAuditLogs(ctx, query);
    return withMeta(items, meta);
  },
});
