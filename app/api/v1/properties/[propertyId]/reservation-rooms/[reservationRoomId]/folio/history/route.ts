import { definePropertyRoute } from "@/lib/http/route";
import { reservationRoomParamsSchema } from "@/modules/billing/billing.schema";
import { folioHistory } from "@/modules/billing/billing.service";

/** Financial audit trail of the stay's windows (also requires audit:read). */
export const GET = definePropertyRoute({
  permission: "billing:read",
  params: reservationRoomParamsSchema,
  handler: ({ ctx, params }) => folioHistory(ctx, params.reservationRoomId),
});
