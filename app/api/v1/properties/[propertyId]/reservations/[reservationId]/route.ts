import { definePropertyRoute } from "@/lib/http/route";
import { reservationParamsSchema } from "@/modules/reservations/reservations.schema";
import { getReservation } from "@/modules/reservations/reservations.service";

export const GET = definePropertyRoute({
  permission: "reservations:read",
  params: reservationParamsSchema,
  handler: ({ ctx, params }) => getReservation(ctx, params.reservationId),
});
