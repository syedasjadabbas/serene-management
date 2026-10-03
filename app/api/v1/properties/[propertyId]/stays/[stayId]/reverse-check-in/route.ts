import { definePropertyRoute } from "@/lib/http/route";
import { reverseCheckInSchema, stayParamsSchema } from "@/modules/front-desk/front-desk.schema";
import { reverseCheckIn } from "@/modules/front-desk/front-desk.service";

/** Reverse a same-day check-in with no postings (PMS_WORKFLOWS §6.3); HIGH risk, needs a reason. */
export const POST = definePropertyRoute({
  permission: "frontdesk:reverse_checkin",
  params: stayParamsSchema,
  body: reverseCheckInSchema,
  handler: ({ ctx, params, body }) => reverseCheckIn(ctx, params.stayId, body),
});
