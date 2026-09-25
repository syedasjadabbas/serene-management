import { defineSessionRoute } from "@/lib/http/route";
import { guestParamsSchema, updateGuestSchema } from "@/modules/guests/guests.schema";
import { getGuest, updateGuest } from "@/modules/guests/guests.service";

export const GET = defineSessionRoute({
  params: guestParamsSchema,
  handler: ({ ctx, params }) => getGuest(ctx, params.guestId),
});

export const PATCH = defineSessionRoute({
  params: guestParamsSchema,
  body: updateGuestSchema,
  handler: ({ ctx, params, body }) => updateGuest(ctx, params.guestId, body),
});
