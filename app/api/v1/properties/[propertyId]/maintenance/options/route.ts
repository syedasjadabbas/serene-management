import { definePropertyRoute } from "@/lib/http/route";
import { maintenanceOptions } from "@/modules/maintenance/maintenance.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Categories, assignees and block reasons for reporting and assigning work. */
export const GET = definePropertyRoute({
  permission: "maintenance:create",
  params: propertyParamsSchema,
  handler: ({ ctx }) => maintenanceOptions(ctx),
});
