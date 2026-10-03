import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import {
  createReservationSchema,
  listReservationsQuerySchema,
} from "@/modules/reservations/reservations.schema";
import { createReservation, listReservations } from "@/modules/reservations/reservations.service";

export const GET = definePropertyRoute({
  permission: "reservations:read",
  params: propertyParamsSchema,
  query: listReservationsQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listReservations(ctx, query);
    return withMeta(items, meta);
  },
});

export const POST = definePropertyRoute({
  permission: "reservations:create",
  params: propertyParamsSchema,
  body: createReservationSchema,
  /** An Idempotency-Key, when sent, makes a retried booking return the first one. */
  idempotent: "optional",
  status: 201,
  handler: ({ ctx, body, idempotency }) => createReservation(ctx, body, idempotency),
});
