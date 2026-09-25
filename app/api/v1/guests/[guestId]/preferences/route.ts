import { defineSessionRoute } from "@/lib/http/route";
import { guestParamsSchema, guestPreferencesSchema } from "@/modules/guests/guests.schema";
import { setGuestPreferences } from "@/modules/guests/guests.service";

/** Replaces the guest's preferences at the scopes the caller manages. */
export const PUT = defineSessionRoute({
  params: guestParamsSchema,
  body: guestPreferencesSchema,
  handler: ({ ctx, params, body }) => setGuestPreferences(ctx, params.guestId, body),
});
