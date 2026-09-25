import { definePropertyRoute } from "@/lib/http/route";
import { estimateStayCharges } from "@/modules/billing/billing.service";
import { reservationRoomParamsSchema } from "@/modules/reservations/reservations.schema";

/** Expected room, package and tax charges per night (computed by the posting engine; nothing is posted). */
export const GET = definePropertyRoute({
  permission: "reservations:read",
  params: reservationRoomParamsSchema,
  handler: ({ ctx, params }) => estimateStayCharges(ctx, params.reservationRoomId),
});
