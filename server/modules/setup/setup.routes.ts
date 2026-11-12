import { Router } from "express";
import { validateBody, validateParams } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./setup.controller";
import {
  createFloorSchema,
  createRoomTypeSchema,
  createRoomsSchema,
  createTaxSchema,
  floorParamsSchema,
  roomParamsSchema,
  roomTypeParamsSchema,
  setupParamsSchema,
  taxParamsSchema,
  updateFloorSchema,
  updateRoomSchema,
  updateRoomTypeSchema,
  updateTaxSchema,
} from "./setup.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/setup",
  requireAuth,
  propertyScope,
  requirePermission("settings:read"),
  validateParams(setupParamsSchema),
  controller.get,
);

router.post(
  "/properties/:propertyId/setup/floors",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(setupParamsSchema),
  validateBody(createFloorSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.addFloor,
);

router.patch(
  "/properties/:propertyId/setup/floors/:floorId",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(floorParamsSchema),
  validateBody(updateFloorSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.editFloor,
);

router.post(
  "/properties/:propertyId/setup/room-types",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(setupParamsSchema),
  validateBody(createRoomTypeSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.addRoomType,
);

router.patch(
  "/properties/:propertyId/setup/room-types/:roomTypeId",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(roomTypeParamsSchema),
  validateBody(updateRoomTypeSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.editRoomType,
);

router.post(
  "/properties/:propertyId/setup/rooms",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(setupParamsSchema),
  validateBody(createRoomsSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.addRooms,
);

router.patch(
  "/properties/:propertyId/setup/rooms/:roomId",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(roomParamsSchema),
  validateBody(updateRoomSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.editRoom,
);

router.post(
  "/properties/:propertyId/setup/taxes",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(setupParamsSchema),
  validateBody(createTaxSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.addTax,
);

router.patch(
  "/properties/:propertyId/setup/taxes/:taxRuleId",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(taxParamsSchema),
  validateBody(updateTaxSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.editTax,
);
