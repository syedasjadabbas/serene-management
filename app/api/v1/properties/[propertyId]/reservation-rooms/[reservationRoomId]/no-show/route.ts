import { definePropertyRoute } from "@/lib/http/route";
import {
  noShowReservationSchema,
  reservationRoomParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { markNoShow } from "@/modules/reservations/reservations.service";

/** High-risk: only on or after the arrival business date; releases inventory and room. */
export const POST = definePropertyRoute({
  permission: "reservations:no_show",
  params: reservationRoomParamsSchema,
  body: noShowReservationSchema,
  handler: ({ ctx, params, body }) => markNoShow(ctx, params.reservationRoomId, body),
});
