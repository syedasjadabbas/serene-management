import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { idempotency } from "@/middlewares/idempotency";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./groups.controller";
import {
  allocationSchema,
  blockParamsSchema,
  blockStatusSchema,
  createBlockSchema,
  createGroupSchema,
  groupParamsSchema,
  groupStatusSchema,
  groupsQuerySchema,
  pickupSchema,
  propertyParamsSchema,
  releaseSchema,
  updateGroupSchema,
} from "./groups.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/groups",
  requireAuth,
  propertyScope,
  requirePermission("groups:read"),
  validateParams(propertyParamsSchema),
  validateQuery(groupsQuerySchema),
  controller.list,
);

router.post(
  "/properties/:propertyId/groups",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(propertyParamsSchema),
  validateBody(createGroupSchema),
  requireReasonForHighRisk("groups:manage"),
  controller.create,
);

router.get(
  "/properties/:propertyId/groups/options",
  requireAuth,
  propertyScope,
  requirePermission("groups:read"),
  validateParams(propertyParamsSchema),
  controller.options,
);

router.get(
  "/properties/:propertyId/groups/:groupId",
  requireAuth,
  propertyScope,
  requirePermission("groups:read"),
  validateParams(groupParamsSchema),
  controller.get,
);

router.patch(
  "/properties/:propertyId/groups/:groupId",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(groupParamsSchema),
  validateBody(updateGroupSchema),
  requireReasonForHighRisk("groups:manage"),
  controller.update,
);

router.post(
  "/properties/:propertyId/groups/:groupId/blocks",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(groupParamsSchema),
  validateBody(createBlockSchema),
  requireReasonForHighRisk("groups:manage"),
  controller.createBlock,
);

router.post(
  "/properties/:propertyId/groups/:groupId/status",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(groupParamsSchema),
  validateBody(groupStatusSchema),
  requireReasonForHighRisk("groups:manage"),
  controller.changeGroupStatus,
);

router.post(
  "/properties/:propertyId/blocks/:blockId/allocation",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(blockParamsSchema),
  validateBody(allocationSchema),
  requireReasonForHighRisk("groups:manage"),
  controller.setAllocation,
);

router.post(
  "/properties/:propertyId/blocks/:blockId/pickups",
  requireAuth,
  propertyScope,
  requirePermission("reservations:create"),
  rateLimit({ name: "groups.pickup", limit: 120, windowMs: 60_000 }),
  validateParams(blockParamsSchema),
  validateBody(pickupSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("reservations:create"),
  controller.pickup,
);

router.post(
  "/properties/:propertyId/blocks/:blockId/release",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(blockParamsSchema),
  validateBody(releaseSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("groups:manage"),
  controller.releaseBlock,
);

router.post(
  "/properties/:propertyId/blocks/:blockId/status",
  requireAuth,
  propertyScope,
  requirePermission("groups:manage"),
  validateParams(blockParamsSchema),
  validateBody(blockStatusSchema),
  requireReasonForHighRisk("groups:manage"),
  controller.changeBlockStatus,
);
