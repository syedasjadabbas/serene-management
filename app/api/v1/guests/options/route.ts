import { defineSessionRoute } from "@/lib/http/route";
import { guestOptions } from "@/modules/guests/guests.service";

/** VIP levels, preference catalog and the properties the caller may scope to. */
export const GET = defineSessionRoute({
  handler: ({ ctx }) => guestOptions(ctx),
});
