import { Router } from "express";
import { validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./audit.controller";
import {
  auditLogQuerySchema,
  organizationAuditLogQuerySchema,
  propertyParamsSchema,
} from "./audit.validators";

export const router = Router();

// The service limits rows to the caller's audit scope.
router.get(
  "/audit-logs",
  requireAuth,
  validateQuery(organizationAuditLogQuerySchema),
  controller.listOrganization,
);

router.get(
  "/properties/:propertyId/audit-logs",
  requireAuth,
  propertyScope,
  requirePermission("audit:read"),
  validateParams(propertyParamsSchema),
  validateQuery(auditLogQuerySchema),
  controller.listProperty,
);
