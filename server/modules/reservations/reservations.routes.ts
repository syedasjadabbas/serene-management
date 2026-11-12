import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { idempotency } from "@/middlewares/idempotency";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./reservations.controller";
import {
  assignRoomSchema,
  availableRoomsQuerySchema,
  cancelReservationSchema,
  confirmReservationSchema,
  createReservationSchema,
  listReservationsQuerySchema,
  noShowReservationSchema,
  propertyParamsSchema,
  reinstateReservationSchema,
  reservationCompanySchema,
  reservationPackageParamsSchema,
  reservationPackageSchema,
  reservationParamsSchema,
  reservationRoomParamsSchema,
  updateReservationRoomSchema,
} from "./reservations.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/booking-options",
  requireAuth,
  propertyScope,
  requirePermission("reservations:read"),
  validateParams(propertyParamsSchema),
  controller.bookingOptions,
);

router.get(
  "/properties/:propertyId/rooms/available",
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(propertyParamsSchema),
  validateQuery(availableRoomsQuerySchema),
  controller.availableRooms,
);

router.get(
  "/properties/:propertyId/reservations",
  requireAuth,
  propertyScope,
  requirePermission("reservations:read"),
  validateParams(propertyParamsSchema),
  validateQuery(listReservationsQuerySchema),
  controller.list,
);

router.post(
  "/properties/:propertyId/reservations",
  requireAuth,
  propertyScope,
  requirePermission("reservations:create"),
  validateParams(propertyParamsSchema),
  validateBody(createReservationSchema),
  idempotency({ required: false }),
  requireReasonForHighRisk("reservations:create"),
  controller.create,
);

router.get(
  "/properties/:propertyId/reservations/:reservationId",
  requireAuth,
  propertyScope,
  requirePermission("reservations:read"),
  validateParams(reservationParamsSchema),
  controller.get,
);

router.put(
  "/properties/:propertyId/reservations/:reservationId/company",
  requireAuth,
  propertyScope,
  requirePermission("reservations:update"),
  validateParams(reservationParamsSchema),
  validateBody(reservationCompanySchema),
  requireReasonForHighRisk("reservations:update"),
  controller.setCompany,
);

router.patch(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId",
  requireAuth,
  propertyScope,
  requirePermission("reservations:update"),
  validateParams(reservationRoomParamsSchema),
  validateBody(updateReservationRoomSchema),
  requireReasonForHighRisk("reservations:update"),
  controller.updateRoom,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/assign-room",
  requireAuth,
  propertyScope,
  requirePermission("rooms:assign"),
  validateParams(reservationRoomParamsSchema),
  validateBody(assignRoomSchema),
  requireReasonForHighRisk("rooms:assign"),
  controller.assignRoom,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/cancel",
  requireAuth,
  propertyScope,
  requirePermission("reservations:cancel"),
  validateParams(reservationRoomParamsSchema),
  validateBody(cancelReservationSchema),
  requireReasonForHighRisk("reservations:cancel"),
  controller.cancel,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/confirm",
  requireAuth,
  propertyScope,
  requirePermission("reservations:update"),
  validateParams(reservationRoomParamsSchema),
  validateBody(confirmReservationSchema),
  requireReasonForHighRisk("reservations:update"),
  controller.confirm,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/no-show",
  requireAuth,
  propertyScope,
  requirePermission("reservations:no_show"),
  validateParams(reservationRoomParamsSchema),
  validateBody(noShowReservationSchema),
  requireReasonForHighRisk("reservations:no_show"),
  controller.noShow,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/packages",
  requireAuth,
  propertyScope,
  requirePermission("reservations:update"),
  validateParams(reservationRoomParamsSchema),
  validateBody(reservationPackageSchema),
  requireReasonForHighRisk("reservations:update"),
  controller.addPackage,
);

router.delete(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/packages/:reservationPackageId",
  requireAuth,
  propertyScope,
  requirePermission("reservations:update"),
  validateParams(reservationPackageParamsSchema),
  requireReasonForHighRisk("reservations:update"),
  controller.removePackage,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/reinstate",
  requireAuth,
  propertyScope,
  requirePermission("reservations:reinstate"),
  validateParams(reservationRoomParamsSchema),
  validateBody(reinstateReservationSchema),
  requireReasonForHighRisk("reservations:reinstate"),
  controller.reinstate,
);

router.post(
  "/properties/:propertyId/reservation-rooms/:reservationRoomId/reinstate-no-show",
  requireAuth,
  propertyScope,
  requirePermission("reservations:reinstate"),
  validateParams(reservationRoomParamsSchema),
  validateBody(reinstateReservationSchema),
  requireReasonForHighRisk("reservations:reinstate"),
  controller.reinstateNoShow,
);
