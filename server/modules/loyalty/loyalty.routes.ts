import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import * as controller from "./loyalty.controller";
import {
  changeMembershipSchema,
  createProgramSchema,
  createTierSchema,
  enrollSchema,
  guestParamsSchema,
  membersQuerySchema,
  membershipParamsSchema,
  pointsAdjustmentSchema,
  programParamsSchema,
  tierParamsSchema,
  updateProgramSchema,
  updateTierSchema,
} from "./loyalty.validators";

/** Loyalty programs, tiers and memberships; the service authorizes per scope. */
export const router = Router();

router.get("/loyalty/programs", requireAuth, controller.overview);
router.post(
  "/loyalty/programs",
  requireAuth,
  validateBody(createProgramSchema),
  controller.createProgram,
);
router.patch(
  "/loyalty/programs/:programId",
  requireAuth,
  validateParams(programParamsSchema),
  validateBody(updateProgramSchema),
  controller.updateProgram,
);
router.get(
  "/loyalty/programs/:programId/members",
  requireAuth,
  validateParams(programParamsSchema),
  validateQuery(membersQuerySchema),
  controller.listMembers,
);
router.post(
  "/loyalty/programs/:programId/tiers",
  requireAuth,
  validateParams(programParamsSchema),
  validateBody(createTierSchema),
  controller.createTier,
);
router.patch(
  "/loyalty/tiers/:tierId",
  requireAuth,
  validateParams(tierParamsSchema),
  validateBody(updateTierSchema),
  controller.updateTier,
);

router.patch(
  "/loyalty/memberships/:membershipId",
  requireAuth,
  validateParams(membershipParamsSchema),
  validateBody(changeMembershipSchema),
  controller.changeMembership,
);
router.post(
  "/loyalty/memberships/:membershipId/adjustments",
  requireAuth,
  validateParams(membershipParamsSchema),
  validateBody(pointsAdjustmentSchema),
  controller.adjustPoints,
);

// Enrolment is a guest sub-resource but belongs to the loyalty module.
router.post(
  "/guests/:guestId/loyalty",
  requireAuth,
  validateParams(guestParamsSchema),
  validateBody(enrollSchema),
  controller.enrollGuest,
);
