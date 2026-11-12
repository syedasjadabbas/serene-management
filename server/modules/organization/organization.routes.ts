import { Router } from "express";
import { validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./organization.controller";
import {
  centralAvailabilityQuerySchema,
  organizationPerformanceQuerySchema,
} from "./organization.validators";

export const router = Router();

/** One card per accessible property: business date, today's figures. */
router.get("/organization/overview", requireAuth, controller.overview);

/** Occupancy and revenue per property and per currency, never converted. */
router.get(
  "/organization/reports/performance",
  requireAuth,
  rateLimit({ name: "reports.run", limit: 120, windowMs: 60_000 }),
  validateQuery(organizationPerformanceQuerySchema),
  controller.performance,
);

router.get(
  "/organization/reports/performance/export",
  requireAuth,
  rateLimit({ name: "reports.export", limit: 30, windowMs: 60_000 }),
  validateQuery(organizationPerformanceQuerySchema),
  controller.exportPerformance,
);

/** Central availability across accessible properties. */
router.get(
  "/availability",
  requireAuth,
  rateLimit({ name: "availability.central", limit: 60, windowMs: 60_000 }),
  validateQuery(centralAvailabilityQuerySchema),
  controller.availability,
);
