import { Router } from "express";
import { validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./reports.controller";
import {
  dashboardParamsSchema,
  reportParamsSchema,
  reportQuerySchema,
  reportsParamsSchema,
} from "./reports.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/dashboard",
  requireAuth,
  propertyScope,
  requirePermission("dashboard:read"),
  validateParams(dashboardParamsSchema),
  controller.dashboard,
);

router.get(
  "/properties/:propertyId/reports",
  requireAuth,
  propertyScope,
  validateParams(reportsParamsSchema),
  controller.list,
);

router.get(
  "/properties/:propertyId/reports/:reportKey",
  requireAuth,
  propertyScope,
  rateLimit({ name: "reports.run", limit: 120, windowMs: 60_000 }),
  validateParams(reportParamsSchema),
  validateQuery(reportQuerySchema),
  controller.run,
);

router.get(
  "/properties/:propertyId/reports/:reportKey/export",
  requireAuth,
  propertyScope,
  requirePermission("reports:export"),
  rateLimit({ name: "reports.export", limit: 30, windowMs: 60_000 }),
  validateParams(reportParamsSchema),
  validateQuery(reportQuerySchema),
  controller.exportCsv,
);
