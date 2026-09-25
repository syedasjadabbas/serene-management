import { definePropertyRoute } from "@/lib/http/route";
import {
  reservationCompanySchema,
  reservationParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { setReservationCompany } from "@/modules/reservations/reservations.service";

/** Sets or clears the company (and booking contact) of a reservation. */
export const PUT = definePropertyRoute({
  permission: "reservations:update",
  params: reservationParamsSchema,
  body: reservationCompanySchema,
  handler: ({ ctx, params, body }) => setReservationCompany(ctx, params.reservationId, body),
});
