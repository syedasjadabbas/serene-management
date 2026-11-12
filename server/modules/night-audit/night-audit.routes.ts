import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { idempotency } from "@/middlewares/idempotency";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./night-audit.controller";
import {
  nightAuditParamsSchema,
  nightAuditRunParamsSchema,
  nightAuditRunsQuerySchema,
  recoverNightAuditSchema,
  startNightAuditSchema,
} from "./night-audit.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/night-audits",
  requireAuth,
  propertyScope,
  requirePermission("nightaudit:read"),
  validateParams(nightAuditParamsSchema),
  validateQuery(nightAuditRunsQuerySchema),
  controller.listRuns,
);

router.post(
  "/properties/:propertyId/night-audits",
  requireAuth,
  propertyScope,
  requirePermission("nightaudit:run"),
  rateLimit({ name: "nightaudit.start", limit: 10, windowMs: 60_000 }),
  validateParams(nightAuditParamsSchema),
  validateBody(startNightAuditSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("nightaudit:run"),
  controller.start,
);

// Declared before /:runId so "readiness" is not read as a run id.
router.get(
  "/properties/:propertyId/night-audits/readiness",
  requireAuth,
  propertyScope,
  requirePermission("nightaudit:read"),
  validateParams(nightAuditParamsSchema),
  controller.readiness,
);

router.get(
  "/properties/:propertyId/night-audits/:runId",
  requireAuth,
  propertyScope,
  requirePermission("nightaudit:read"),
  validateParams(nightAuditRunParamsSchema),
  controller.getRun,
);

router.post(
  "/properties/:propertyId/night-audits/:runId/recover",
  requireAuth,
  propertyScope,
  requirePermission("nightaudit:run"),
  validateParams(nightAuditRunParamsSchema),
  validateBody(recoverNightAuditSchema),
  requireReasonForHighRisk("nightaudit:run"),
  controller.recover,
);
