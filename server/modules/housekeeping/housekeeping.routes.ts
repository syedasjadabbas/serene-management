import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./housekeeping.controller";
import {
  assignTaskSchema,
  closeTaskSchema,
  createTaskSchema,
  propertyParamsSchema,
  taskCommandSchema,
  taskParamsSchema,
  tasksQuerySchema,
} from "./housekeeping.validators";

export const router = Router();

const P = "/properties/:propertyId";

router.get(
  `${P}/housekeeping/options`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:read"),
  validateParams(propertyParamsSchema),
  controller.options,
);

router.get(
  `${P}/housekeeping/summary`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:read"),
  validateParams(propertyParamsSchema),
  controller.summary,
);

router.get(
  `${P}/housekeeping/tasks`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:read"),
  validateParams(propertyParamsSchema),
  validateQuery(tasksQuerySchema),
  controller.listTasksHandler,
);

router.post(
  `${P}/housekeeping/tasks`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:assign"),
  validateParams(propertyParamsSchema),
  validateBody(createTaskSchema),
  requireReasonForHighRisk("housekeeping:assign"),
  controller.createTaskHandler,
);

router.get(
  `${P}/housekeeping/tasks/:taskId`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:read"),
  validateParams(taskParamsSchema),
  controller.getTaskHandler,
);

router.post(
  `${P}/housekeeping/tasks/:taskId/assign`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:assign"),
  validateParams(taskParamsSchema),
  validateBody(assignTaskSchema),
  requireReasonForHighRisk("housekeeping:assign"),
  controller.assign,
);

router.post(
  `${P}/housekeeping/tasks/:taskId/cancel`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:assign"),
  validateParams(taskParamsSchema),
  validateBody(closeTaskSchema),
  requireReasonForHighRisk("housekeeping:assign"),
  controller.cancel,
);

router.post(
  `${P}/housekeeping/tasks/:taskId/skip`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:update"),
  validateParams(taskParamsSchema),
  validateBody(closeTaskSchema),
  requireReasonForHighRisk("housekeeping:update"),
  controller.skip,
);

router.post(
  `${P}/housekeeping/tasks/:taskId/start`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:update"),
  validateParams(taskParamsSchema),
  validateBody(taskCommandSchema),
  requireReasonForHighRisk("housekeeping:update"),
  controller.start,
);

router.post(
  `${P}/housekeeping/tasks/:taskId/pause`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:update"),
  validateParams(taskParamsSchema),
  validateBody(taskCommandSchema),
  requireReasonForHighRisk("housekeeping:update"),
  controller.pause,
);

router.post(
  `${P}/housekeeping/tasks/:taskId/complete`,
  requireAuth,
  propertyScope,
  requirePermission("housekeeping:update"),
  validateParams(taskParamsSchema),
  validateBody(taskCommandSchema),
  requireReasonForHighRisk("housekeeping:update"),
  controller.complete,
);
