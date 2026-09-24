import { definePropertyRoute } from "@/lib/http/route";
import {
  cancelReservationSchema,
  reservationRoomParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { cancelReservation } from "@/modules/reservations/reservations.service";

/** High-risk: reason code and written reason required; releases inventory and room. */
export const POST = definePropertyRoute({
  permission: "reservations:cancel",
  params: reservationRoomParamsSchema,
  body: cancelReservationSchema,
  handler: ({ ctx, params, body }) => cancelReservation(ctx, params.reservationRoomId, body),
});
