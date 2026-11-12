import { Router } from "express";
import { validateParams } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { propertyScope } from "@/middlewares/propertyScope";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./realtime.controller";
import { propertyParamsSchema } from "./realtime.validators";

export const router = Router();

/**
 * Any user with access to the property may subscribe; the service limits the
 * topics to what they may read there. Reconnects are rate limited per user.
 * The response is an event stream: app.ts has no compression middleware, the
 * stream sets no-transform, and the app-level cors middleware has already set
 * its headers before this route runs.
 */
router.get(
  "/properties/:propertyId/events",
  requireAuth,
  propertyScope,
  rateLimit({ name: "realtime.connect", limit: 30, windowMs: 60_000 }),
  validateParams(propertyParamsSchema),
  controller.events,
);
