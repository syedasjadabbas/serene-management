import { definePropertyRoute } from "@/lib/http/route";
import {
  confirmReservationSchema,
  reservationRoomParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { confirmReservation } from "@/modules/reservations/reservations.service";

/** Tentative or waitlisted → confirmed (inventory-deducting reservation type). */
export const POST = definePropertyRoute({
  permission: "reservations:update",
  params: reservationRoomParamsSchema,
  body: confirmReservationSchema,
  handler: ({ ctx, params, body }) => confirmReservation(ctx, params.reservationRoomId, body),
});
