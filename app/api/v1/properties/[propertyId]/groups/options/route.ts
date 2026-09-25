import { definePropertyRoute } from "@/lib/http/route";
import { groupOptions } from "@/modules/groups/groups.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "groups:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => groupOptions(ctx),
});
