import { definePropertyRoute } from "@/lib/http/route";
import { listAssignees, listTaskTypes } from "@/modules/housekeeping/housekeeping.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Task types and the users who can be given housekeeping work. */
export const GET = definePropertyRoute({
  permission: "housekeeping:read",
  params: propertyParamsSchema,
  handler: async ({ ctx }) => ({
    taskTypes: await listTaskTypes(ctx),
    assignees: await listAssignees(ctx),
  }),
});
