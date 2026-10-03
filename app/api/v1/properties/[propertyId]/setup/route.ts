import { definePropertyRoute } from "@/lib/http/route";
import { setupParamsSchema } from "@/modules/setup/setup.schema";
import { getPropertySetup } from "@/modules/setup/setup.service";

/** Room types, floors, rooms, taxes and the go-live checklist of the property. */
export const GET = definePropertyRoute({
  permission: "settings:read",
  params: setupParamsSchema,
  handler: ({ ctx }) => getPropertySetup(ctx),
});
