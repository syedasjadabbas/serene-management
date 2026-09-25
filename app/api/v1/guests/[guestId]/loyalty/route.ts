import { defineSessionRoute } from "@/lib/http/route";
import { guestParamsSchema } from "@/modules/guests/guests.schema";
import { enrollSchema } from "@/modules/loyalty/loyalty.schema";
import { enrollGuest } from "@/modules/loyalty/loyalty.service";

/** Enrolls the guest in a loyalty program (loyalty:manage, reason required). */
export const POST = defineSessionRoute({
  params: guestParamsSchema,
  body: enrollSchema,
  status: 201,
  handler: ({ ctx, params, body }) => enrollGuest(ctx, params.guestId, body),
});
