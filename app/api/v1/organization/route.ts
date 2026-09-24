import { defineSessionRoute } from "@/lib/http/route";
import { getOrganization } from "@/modules/properties/properties.service";

export const GET = defineSessionRoute({
  handler: ({ ctx }) => getOrganization(ctx),
});
