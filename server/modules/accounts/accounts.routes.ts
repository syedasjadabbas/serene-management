import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import * as controller from "./accounts.controller";
import {
  accountContactParamsSchema,
  accountContactSchema,
  accountParamsSchema,
  accountsQuerySchema,
  createAccountSchema,
  updateAccountSchema,
} from "./accounts.validators";

/** Company / travel-agent profiles; authorization is decided by the service per scope. */
export const router = Router();

router.get("/accounts", requireAuth, validateQuery(accountsQuerySchema), controller.list);
router.post("/accounts", requireAuth, validateBody(createAccountSchema), controller.create);

router.get(
  "/accounts/:accountId",
  requireAuth,
  validateParams(accountParamsSchema),
  controller.get,
);
router.patch(
  "/accounts/:accountId",
  requireAuth,
  validateParams(accountParamsSchema),
  validateBody(updateAccountSchema),
  controller.update,
);

router.put(
  "/accounts/:accountId/contacts/:guestId",
  requireAuth,
  validateParams(accountContactParamsSchema),
  validateBody(accountContactSchema),
  controller.setContact,
);
router.delete(
  "/accounts/:accountId/contacts/:guestId",
  requireAuth,
  validateParams(accountContactParamsSchema),
  controller.removeContact,
);
