import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./maintenance.controller";
import {
  assignRequestSchema,
  blockRequestRoomSchema,
  cancelRequestSchema,
  createRequestSchema,
  noteSchema,
  propertyParamsSchema,
  requestCommandSchema,
  requestParamsSchema,
  requestsQuerySchema,
  resolveRequestSchema,
} from "./maintenance.validators";

export const router = Router();

const P = "/properties/:propertyId";

router.get(
  `${P}/maintenance`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:read"),
  validateParams(propertyParamsSchema),
  validateQuery(requestsQuerySchema),
  controller.list,
);

router.post(
  `${P}/maintenance`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:create"),
  validateParams(propertyParamsSchema),
  validateBody(createRequestSchema),
  requireReasonForHighRisk("maintenance:create"),
  controller.create,
);

router.get(
  `${P}/maintenance/options`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:create"),
  validateParams(propertyParamsSchema),
  controller.options,
);

router.get(
  `${P}/maintenance/summary`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:read"),
  validateParams(propertyParamsSchema),
  controller.summary,
);

router.get(
  `${P}/maintenance/:requestId`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:read"),
  validateParams(requestParamsSchema),
  controller.get,
);

router.post(
  `${P}/maintenance/:requestId/assign`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:manage"),
  validateParams(requestParamsSchema),
  validateBody(assignRequestSchema),
  requireReasonForHighRisk("maintenance:manage"),
  controller.assign,
);

router.post(
  `${P}/maintenance/:requestId/block-room`,
  requireAuth,
  propertyScope,
  requirePermission("rooms:out_of_order"),
  validateParams(requestParamsSchema),
  validateBody(blockRequestRoomSchema),
  requireReasonForHighRisk("rooms:out_of_order"),
  controller.blockRoom,
);

router.post(
  `${P}/maintenance/:requestId/cancel`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:manage"),
  validateParams(requestParamsSchema),
  validateBody(cancelRequestSchema),
  requireReasonForHighRisk("maintenance:manage"),
  controller.cancel,
);

router.post(
  `${P}/maintenance/:requestId/close`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:manage"),
  validateParams(requestParamsSchema),
  validateBody(requestCommandSchema),
  requireReasonForHighRisk("maintenance:manage"),
  controller.close,
);

router.post(
  `${P}/maintenance/:requestId/reopen`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:manage"),
  validateParams(requestParamsSchema),
  validateBody(requestCommandSchema),
  requireReasonForHighRisk("maintenance:manage"),
  controller.reopen,
);

router.post(
  `${P}/maintenance/:requestId/hold`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:update"),
  validateParams(requestParamsSchema),
  validateBody(requestCommandSchema),
  requireReasonForHighRisk("maintenance:update"),
  controller.hold,
);

router.post(
  `${P}/maintenance/:requestId/resume`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:update"),
  validateParams(requestParamsSchema),
  validateBody(requestCommandSchema),
  requireReasonForHighRisk("maintenance:update"),
  controller.resume,
);

router.post(
  `${P}/maintenance/:requestId/start`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:update"),
  validateParams(requestParamsSchema),
  validateBody(requestCommandSchema),
  requireReasonForHighRisk("maintenance:update"),
  controller.start,
);

router.post(
  `${P}/maintenance/:requestId/notes`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:update"),
  validateParams(requestParamsSchema),
  validateBody(noteSchema),
  requireReasonForHighRisk("maintenance:update"),
  controller.addNoteHandler,
);

router.post(
  `${P}/maintenance/:requestId/resolve`,
  requireAuth,
  propertyScope,
  requirePermission("maintenance:update"),
  validateParams(requestParamsSchema),
  validateBody(resolveRequestSchema),
  requireReasonForHighRisk("maintenance:update"),
  controller.resolve,
);
