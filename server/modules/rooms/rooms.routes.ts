import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./rooms.controller";
import {
  blockParamsSchema,
  inspectRoomSchema,
  placeBlockSchema,
  propertyParamsSchema,
  releaseBlockSchema,
  roomBoardQuerySchema,
  roomHousekeepingSchema,
  roomParamsSchema,
} from "./rooms.validators";

export const router = Router();

const P = "/properties/:propertyId";

router.get(
  `${P}/rooms/board`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(propertyParamsSchema),
  validateQuery(roomBoardQuerySchema),
  controller.board,
);

router.get(
  `${P}/rooms/board-options`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(propertyParamsSchema),
  controller.boardOptions,
);

router.get(
  `${P}/rooms/picker`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(propertyParamsSchema),
  controller.picker,
);

router.get(
  `${P}/rooms/:roomId`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:read"),
  validateParams(roomParamsSchema),
  controller.get,
);

router.post(
  `${P}/rooms/:roomId/blocks`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:out_of_order"),
  validateParams(roomParamsSchema),
  validateBody(placeBlockSchema),
  requireReasonForHighRisk("rooms:out_of_order"),
  controller.placeBlock,
);

router.post(
  `${P}/room-blocks/:blockId/release`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:out_of_order"),
  validateParams(blockParamsSchema),
  validateBody(releaseBlockSchema),
  requireReasonForHighRisk("rooms:out_of_order"),
  controller.releaseBlock,
);

router.post(
  `${P}/rooms/:roomId/inspect`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:inspect"),
  validateParams(roomParamsSchema),
  validateBody(inspectRoomSchema),
  requireReasonForHighRisk("housekeeping:inspect"),
  controller.inspect,
);

router.post(
  `${P}/rooms/:roomId/mark-clean`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:assign"),
  validateParams(roomParamsSchema),
  validateBody(roomHousekeepingSchema),
  requireReasonForHighRisk("housekeeping:assign"),
  controller.markClean,
);

router.post(
  `${P}/rooms/:roomId/mark-dirty`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:update"),
  validateParams(roomParamsSchema),
  validateBody(roomHousekeepingSchema),
  requireReasonForHighRisk("housekeeping:update"),
  controller.markDirty,
);
