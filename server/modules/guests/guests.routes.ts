import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import * as controller from "./guests.controller";
import {
  createGuestNoteSchema,
  createGuestSchema,
  guestHistoryQuerySchema,
  guestNoteParamsSchema,
  guestParamsSchema,
  guestPreferencesSchema,
  guestSearchQuerySchema,
  updateGuestSchema,
} from "./guests.validators";

/**
 * Organization-level guest profiles. No route-level permission: the service
 * decides per scope (guests:read / guests:manage anywhere, per property).
 * POST /guests/:guestId/loyalty lives in the loyalty module.
 */
export const router = Router();

// Registered before /guests/:guestId so "options" is not taken as an id.
router.get("/guests/options", requireAuth, controller.options);

router.get("/guests", requireAuth, validateQuery(guestSearchQuerySchema), controller.list);
router.post("/guests", requireAuth, validateBody(createGuestSchema), controller.create);

router.get("/guests/:guestId", requireAuth, validateParams(guestParamsSchema), controller.get);
router.patch(
  "/guests/:guestId",
  requireAuth,
  validateParams(guestParamsSchema),
  validateBody(updateGuestSchema),
  controller.update,
);

router.get(
  "/guests/:guestId/history",
  requireAuth,
  validateParams(guestParamsSchema),
  validateQuery(guestHistoryQuerySchema),
  controller.history,
);

router.post(
  "/guests/:guestId/notes",
  requireAuth,
  validateParams(guestParamsSchema),
  validateBody(createGuestNoteSchema),
  controller.addNote,
);
router.delete(
  "/guests/:guestId/notes/:noteId",
  requireAuth,
  validateParams(guestNoteParamsSchema),
  controller.deleteNote,
);

router.put(
  "/guests/:guestId/preferences",
  requireAuth,
  validateParams(guestParamsSchema),
  validateBody(guestPreferencesSchema),
  controller.setPreferences,
);
