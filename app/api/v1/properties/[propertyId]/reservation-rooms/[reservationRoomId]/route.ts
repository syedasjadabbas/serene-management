import { definePropertyRoute } from "@/lib/http/route";
import {
  reservationRoomParamsSchema,
  updateReservationRoomSchema,
} from "@/modules/reservations/reservations.schema";
import { updateReservationRoom } from "@/modules/reservations/reservations.service";

/** Modify dates, party, room type, rate plan, guest, codes or ETA of one reservation room. */
export const PATCH = definePropertyRoute({
  permission: "reservations:update",
  params: reservationRoomParamsSchema,
  body: updateReservationRoomSchema,
  handler: ({ ctx, params, body }) => updateReservationRoom(ctx, params.reservationRoomId, body),
});
