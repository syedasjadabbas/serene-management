/**
 * REFERENCE PATTERN for every module router (docs/SERVER_SPLIT_PLAN.md section 3).
 *
 * One `Router` per module, exported as `router` and mounted in app.ts under
 * /api/v1. Each route spells out its pipeline, in this order:
 *
 *   requireAuth                    Bearer JWT -> session -> req.ctx
 *   propertyScope                  :propertyId (uuid + access) -> req.ctx is a PropertyContext
 *   requirePermission(p)           property-scope permission  (organization routes: requireOrgPermission)
 *   rateLimit(rule)                optional per-route limit (per user once authenticated)
 *   validateParams / validateQuery / validateBody   zod schemas from ./<module>.validators.ts
 *   idempotency({ required })      financial commands, after validateBody
 *   requireReasonForHighRisk(p)    after validateBody
 *   controller                     one line: handleProperty((req) => service.fn(req.ctx, ...), { status })
 *
 * Controllers (./<module>.controller.ts) only call a service and return its
 * result; lib/controller.ts sends the envelope and forwards errors. Services
 * never see req/res.
 */
import { Router } from "express";
import { validateBody, validateParams } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./business-date.controller";
import { initializeBusinessDateSchema, propertyParamsSchema } from "./business-date.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/business-date",
  requireAuth,
  propertyScope,
  validateParams(propertyParamsSchema),
  controller.get,
);

router.post(
  "/properties/:propertyId/business-date/initialize",
  requireAuth,
  propertyScope,
  requirePermission("properties:manage"),
  validateParams(propertyParamsSchema),
  validateBody(initializeBusinessDateSchema),
  requireReasonForHighRisk("properties:manage"),
  controller.initialize,
);
