import { Router } from "express";
import { validateBody, validateParams } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requireOrgPermission, requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./properties.controller";
import {
  copySetupParamsSchema,
  copySetupSchema,
  createPropertySchema,
  propertyParamsSchema,
  updatePropertyConfigurationSchema,
} from "./properties.validators";

export const router = Router();

router.get("/organization", requireAuth, controller.getOrganizationView);

router.get("/properties", requireAuth, controller.list);

router.post(
  "/properties",
  requireAuth,
  requireOrgPermission("properties:manage"),
  validateBody(createPropertySchema),
  requireReasonForHighRisk("properties:manage"),
  controller.create,
);

router.get(
  "/properties/:propertyId",
  requireAuth,
  propertyScope,
  validateParams(propertyParamsSchema),
  controller.get,
);

router.get(
  "/properties/:propertyId/configuration",
  requireAuth,
  propertyScope,
  requirePermission("settings:read"),
  validateParams(propertyParamsSchema),
  controller.getConfiguration,
);

router.patch(
  "/properties/:propertyId/configuration",
  requireAuth,
  propertyScope,
  requirePermission("settings:manage"),
  validateParams(propertyParamsSchema),
  validateBody(updatePropertyConfigurationSchema),
  requireReasonForHighRisk("settings:manage"),
  controller.updateConfiguration,
);

router.post(
  "/properties/:propertyId/setup/copy-from/:sourceId",
  requireAuth,
  propertyScope,
  requirePermission("properties:manage"),
  validateParams(copySetupParamsSchema),
  validateBody(copySetupSchema),
  requireReasonForHighRisk("properties:manage"),
  controller.copySetup,
);
