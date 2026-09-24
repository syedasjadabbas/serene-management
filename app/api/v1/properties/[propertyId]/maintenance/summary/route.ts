import { definePropertyRoute } from "@/lib/http/route";
import { maintenanceSummary } from "@/modules/maintenance/maintenance.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "maintenance:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => maintenanceSummary(ctx),
});
