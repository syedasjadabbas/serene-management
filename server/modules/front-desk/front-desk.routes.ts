import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { idempotency } from "@/middlewares/idempotency";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./front-desk.controller";
import {
  arrivalsQuerySchema,
  checkInSchema,
  checkOutSchema,
  departuresQuerySchema,
  extendStaySchema,
  inHouseQuerySchema,
  propertyParamsSchema,
  reservationRoomParamsSchema,
  reverseCheckInSchema,
  roomBoardQuerySchema,
  roomMoveSchema,
  stayParamsSchema,
  walkInSchema,
} from "./front-desk.validators";

export const router = Router();

const P = "/properties/:propertyId";

router.get(
  `${P}/front-desk/arrivals`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:read"),
  validateParams(propertyParamsSchema),
  validateQuery(arrivalsQuerySchema),
  controller.arrivals,
);

router.get(
  `${P}/front-desk/departures`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:read"),
  validateParams(propertyParamsSchema),
  validateQuery(departuresQuerySchema),
  controller.departures,
);

router.get(
  `${P}/front-desk/in-house`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:read"),
  validateParams(propertyParamsSchema),
  validateQuery(inHouseQuerySchema),
  controller.inHouse,
);

router.get(
  `${P}/front-desk/rooms`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(propertyParamsSchema),
  validateQuery(roomBoardQuerySchema),
  controller.rooms,
);

router.get(
  `${P}/front-desk/summary`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:read"),
  validateParams(propertyParamsSchema),
  controller.summary,
);

router.post(
  `${P}/front-desk/walk-ins`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:checkin"),
  validateParams(propertyParamsSchema),
  validateBody(walkInSchema),
  idempotency({ required: false }),
  requireReasonForHighRisk("frontdesk:checkin"),
  controller.walkInStay,
);

router.post(
  `${P}/reservation-rooms/:reservationRoomId/check-in`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:checkin"),
  validateParams(reservationRoomParamsSchema),
  validateBody(checkInSchema),
  requireReasonForHighRisk("frontdesk:checkin"),
  controller.checkInRoom,
);

router.get(
  `${P}/reservation-rooms/:reservationRoomId/room-options`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(reservationRoomParamsSchema),
  controller.roomOptions,
);

router.get(
  `${P}/stays/:stayId`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:read"),
  validateParams(stayParamsSchema),
  controller.stay,
);

router.post(
  `${P}/stays/:stayId/check-out`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:checkout"),
  validateParams(stayParamsSchema),
  validateBody(checkOutSchema),
  requireReasonForHighRisk("frontdesk:checkout"),
  controller.stayCheckOut,
);

router.post(
  `${P}/stays/:stayId/extend`,
  requireAuth,
  propertyScope,
  requirePermission("reservations:update"),
  validateParams(stayParamsSchema),
  validateBody(extendStaySchema),
  requireReasonForHighRisk("reservations:update"),
  controller.stayExtend,
);

router.post(
  `${P}/stays/:stayId/reverse-check-in`,
  requireAuth,
  propertyScope,
  requirePermission("frontdesk:reverse_checkin"),
  validateParams(stayParamsSchema),
  validateBody(reverseCheckInSchema),
  requireReasonForHighRisk("frontdesk:reverse_checkin"),
  controller.stayReverseCheckIn,
);

router.post(
  `${P}/stays/:stayId/room-move`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:assign"),
  validateParams(stayParamsSchema),
  validateBody(roomMoveSchema),
  requireReasonForHighRisk("rooms:assign"),
  controller.stayRoomMove,
);
