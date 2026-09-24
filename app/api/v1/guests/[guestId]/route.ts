import { defineSessionRoute } from "@/lib/http/route";
import { guestParamsSchema } from "@/modules/guests/guests.schema";
import { getGuest } from "@/modules/guests/guests.service";

export const GET = defineSessionRoute({
  params: guestParamsSchema,
  handler: ({ ctx, params }) => getGuest(ctx, params.guestId),
});
