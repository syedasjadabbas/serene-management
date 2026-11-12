import { z } from "zod";
import { idSchema } from "@serene/shared/lib/validation/common";

export { reservationPackageSchema } from "@serene/shared/modules/rates/rates.schema";
export {
  assignRoomSchema,
  availableRoomsQuerySchema,
  cancelReservationSchema,
  confirmReservationSchema,
  createReservationSchema,
  listReservationsQuerySchema,
  noShowReservationSchema,
  reinstateReservationSchema,
  reservationCompanySchema,
  reservationParamsSchema,
  reservationRoomParamsSchema,
  updateReservationRoomSchema,
} from "@serene/shared/modules/reservations/reservations.schema";
export { propertyParamsSchema } from "@serene/shared/modules/properties/properties.schema";

export const reservationPackageParamsSchema = z
  .object({ propertyId: idSchema, reservationRoomId: idSchema, reservationPackageId: idSchema })
  .strict();
