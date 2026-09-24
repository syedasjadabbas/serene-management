import { definePropertyRoute } from "@/lib/http/route";
import {
  reinstateReservationSchema,
  reservationRoomParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { reinstateReservation } from "@/modules/reservations/reservations.service";

/** High-risk: cancelled → reserved when availability allows (or override). */
export const POST = definePropertyRoute({
  permission: "reservations:reinstate",
  params: reservationRoomParamsSchema,
  body: reinstateReservationSchema,
  handler: ({ ctx, params, body }) => reinstateReservation(ctx, params.reservationRoomId, body),
});
