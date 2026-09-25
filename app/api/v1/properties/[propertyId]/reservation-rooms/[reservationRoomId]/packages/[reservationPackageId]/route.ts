import { z } from "zod";
import { definePropertyRoute } from "@/lib/http/route";
import { idSchema } from "@/lib/validation/common";
import { removeReservationPackage } from "@/modules/reservations/reservations.service";

const paramsSchema = z
  .object({ propertyId: idSchema, reservationRoomId: idSchema, reservationPackageId: idSchema })
  .strict();

export const DELETE = definePropertyRoute({
  permission: "reservations:update",
  params: paramsSchema,
  handler: ({ ctx, params }) =>
    removeReservationPackage(ctx, params.reservationRoomId, params.reservationPackageId),
});
