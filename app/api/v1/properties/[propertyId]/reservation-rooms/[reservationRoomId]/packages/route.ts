import { definePropertyRoute } from "@/lib/http/route";
import { reservationPackageSchema } from "@/modules/rates/rates.schema";
import { reservationRoomParamsSchema } from "@/modules/reservations/reservations.schema";
import { addReservationPackage } from "@/modules/reservations/reservations.service";

/** Books a separately sold package on future nights of the stay. */
export const POST = definePropertyRoute({
  permission: "reservations:update",
  params: reservationRoomParamsSchema,
  body: reservationPackageSchema,
  status: 201,
  handler: ({ ctx, params, body }) => addReservationPackage(ctx, params.reservationRoomId, body),
});
