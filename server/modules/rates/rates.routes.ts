import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./rates.controller";
import {
  calendarQuerySchema,
  createPackageSchema,
  createRatePlanSchema,
  deleteSeasonSchema,
  packageParamsSchema,
  propertyParamsSchema,
  ratePlanAccountsSchema,
  ratePlanPackagesSchema,
  ratePlanParamsSchema,
  seasonParamsSchema,
  seasonSchema,
  updatePackageSchema,
  updateRatePlanSchema,
} from "./rates.validators";

export const router = Router();

router.get(
  "/properties/:propertyId/packages",
  requireAuth,
  propertyScope,
  requirePermission("rates:read"),
  validateParams(propertyParamsSchema),
  controller.listPackages,
);

router.post(
  "/properties/:propertyId/packages",
  requireAuth,
  propertyScope,
  requirePermission("packages:manage"),
  validateParams(propertyParamsSchema),
  validateBody(createPackageSchema),
  requireReasonForHighRisk("packages:manage"),
  controller.createPackage,
);

router.get(
  "/properties/:propertyId/packages/:packageId",
  requireAuth,
  propertyScope,
  requirePermission("rates:read"),
  validateParams(packageParamsSchema),
  controller.getPackage,
);

router.patch(
  "/properties/:propertyId/packages/:packageId",
  requireAuth,
  propertyScope,
  requirePermission("packages:manage"),
  validateParams(packageParamsSchema),
  validateBody(updatePackageSchema),
  requireReasonForHighRisk("packages:manage"),
  controller.updatePackage,
);

router.get(
  "/properties/:propertyId/rate-plans",
  requireAuth,
  propertyScope,
  requirePermission("rates:read"),
  validateParams(propertyParamsSchema),
  controller.listRatePlans,
);

router.post(
  "/properties/:propertyId/rate-plans",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(propertyParamsSchema),
  validateBody(createRatePlanSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.createRatePlan,
);

router.get(
  "/properties/:propertyId/rate-plans/:ratePlanId",
  requireAuth,
  propertyScope,
  requirePermission("rates:read"),
  validateParams(ratePlanParamsSchema),
  controller.getRatePlan,
);

router.patch(
  "/properties/:propertyId/rate-plans/:ratePlanId",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(ratePlanParamsSchema),
  validateBody(updateRatePlanSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.updateRatePlan,
);

router.put(
  "/properties/:propertyId/rate-plans/:ratePlanId/accounts",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(ratePlanParamsSchema),
  validateBody(ratePlanAccountsSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.setRatePlanAccounts,
);

router.put(
  "/properties/:propertyId/rate-plans/:ratePlanId/packages",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(ratePlanParamsSchema),
  validateBody(ratePlanPackagesSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.setRatePlanPackages,
);

router.post(
  "/properties/:propertyId/rate-plans/:ratePlanId/seasons",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(ratePlanParamsSchema),
  validateBody(seasonSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.createSeason,
);

router.patch(
  "/properties/:propertyId/rate-plans/:ratePlanId/seasons/:seasonId",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(seasonParamsSchema),
  validateBody(seasonSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.updateSeasonPrices,
);

router.delete(
  "/properties/:propertyId/rate-plans/:ratePlanId/seasons/:seasonId",
  requireAuth,
  propertyScope,
  requirePermission("rates:manage"),
  validateParams(seasonParamsSchema),
  validateBody(deleteSeasonSchema),
  requireReasonForHighRisk("rates:manage"),
  controller.removeSeason,
);

router.get(
  "/properties/:propertyId/rates/calendar",
  requireAuth,
  propertyScope,
  requirePermission("rates:read"),
  validateParams(propertyParamsSchema),
  validateQuery(calendarQuerySchema),
  controller.rateCalendar,
);

router.get(
  "/properties/:propertyId/rates/options",
  requireAuth,
  propertyScope,
  requirePermission("rates:read"),
  validateParams(propertyParamsSchema),
  controller.rateAdminOptions,
);
