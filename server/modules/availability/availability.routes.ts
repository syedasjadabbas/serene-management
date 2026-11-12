import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./availability.controller";
import {
  availabilityQuerySchema,
  propertyParamsSchema,
  restrictionsQuerySchema,
  setRestrictionsSchema,
} from "./availability.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/availability",
  requireAuth,
  propertyScope,
  requirePermission("availability:read"),
  validateParams(propertyParamsSchema),
  validateQuery(availabilityQuerySchema),
  controller.search,
);

router.get(
  "/properties/:propertyId/restrictions",
  requireAuth,
  propertyScope,
  requirePermission("availability:read"),
  validateParams(propertyParamsSchema),
  validateQuery(restrictionsQuerySchema),
  controller.listRestrictionsHandler,
);

router.post(
  "/properties/:propertyId/restrictions",
  requireAuth,
  propertyScope,
  requirePermission("availability:manage"),
  validateParams(propertyParamsSchema),
  validateBody(setRestrictionsSchema),
  requireReasonForHighRisk("availability:manage"),
  controller.setRestrictionsHandler,
);
