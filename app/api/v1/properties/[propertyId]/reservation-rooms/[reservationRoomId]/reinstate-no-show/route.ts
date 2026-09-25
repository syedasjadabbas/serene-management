import { definePropertyRoute } from "@/lib/http/route";
import {
  reinstateReservationSchema,
  reservationRoomParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { reinstateNoShow } from "@/modules/reservations/reservations.service";

/** High-risk: no-show → reserved from the business date while nights remain. */
export const POST = definePropertyRoute({
  permission: "reservations:reinstate",
  params: reservationRoomParamsSchema,
  body: reinstateReservationSchema,
  handler: ({ ctx, params, body }) => reinstateNoShow(ctx, params.reservationRoomId, body),
});
