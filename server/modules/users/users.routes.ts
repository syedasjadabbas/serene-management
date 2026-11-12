import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { requireOrgPermission } from "@/middlewares/permission";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./users.controller";
import {
  grantRoleSchema,
  inviteUserSchema,
  listUsersQuerySchema,
  reasonOnlySchema,
  roleAssignmentParamsSchema,
  userParamsSchema,
} from "./users.validators";

/**
 * User administration. Routes without a route-level permission authorize in
 * the service (the scope of the request decides which users:manage applies).
 */
export const router = Router();

router.get("/roles", requireAuth, controller.listRoles);

router.get("/users", requireAuth, validateQuery(listUsersQuerySchema), controller.list);
router.post(
  "/users",
  requireAuth,
  rateLimit({ name: "users.invite", limit: 30, windowMs: 60_000 }),
  validateBody(inviteUserSchema),
  controller.invite,
);

router.post(
  "/users/:userId/disable",
  requireAuth,
  requireOrgPermission("users:manage"),
  validateParams(userParamsSchema),
  validateBody(reasonOnlySchema),
  requireReasonForHighRisk("users:manage"),
  controller.disable,
);
router.post(
  "/users/:userId/enable",
  requireAuth,
  requireOrgPermission("users:manage"),
  validateParams(userParamsSchema),
  validateBody(reasonOnlySchema),
  requireReasonForHighRisk("users:manage"),
  controller.enable,
);
router.post(
  "/users/:userId/unlock",
  requireAuth,
  requireOrgPermission("users:manage"),
  validateParams(userParamsSchema),
  validateBody(reasonOnlySchema),
  requireReasonForHighRisk("users:manage"),
  controller.unlock,
);
router.post(
  "/users/:userId/password-reset",
  requireAuth,
  requireOrgPermission("users:manage"),
  rateLimit({
    name: "auth.password.reset.issue",
    limit: 10,
    windowMs: 60 * 60_000,
    onStoreFailure: "deny",
  }),
  validateParams(userParamsSchema),
  validateBody(reasonOnlySchema),
  requireReasonForHighRisk("users:manage"),
  controller.passwordReset,
);

// The requested scope decides authorization, so the service checks users:manage there.
router.post(
  "/users/:userId/role-assignments",
  requireAuth,
  validateParams(userParamsSchema),
  validateBody(grantRoleSchema),
  controller.grantRole,
);
router.delete(
  "/users/:userId/role-assignments/:assignmentId",
  requireAuth,
  validateParams(roleAssignmentParamsSchema),
  validateBody(reasonOnlySchema),
  controller.revokeRole,
);
