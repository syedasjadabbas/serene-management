import { Router } from "express";
import { validateBody, validateParams } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { rateLimit } from "@/middlewares/rateLimit";
import { sameOrigin } from "@/middlewares/sameOrigin";
import * as controller from "./identity.controller";
import {
  changePasswordSchema,
  completePasswordResetSchema,
  loginSchema,
  sessionParamsSchema,
  updateProfileSchema,
  uploadAvatarSchema,
} from "./identity.validators";

/**
 * Authentication, the signed-in user's own profile and sessions (task T2).
 * Only /auth/refresh and /auth/logout use the refresh cookie, so only they
 * carry the Origin check; everything else is Bearer-authenticated.
 */
export const router = Router();

// Per-IP brute-force brake; per-account lockout is enforced by the service.
router.post(
  "/auth/login",
  rateLimit({ name: "auth.login.ip", limit: 20, windowMs: 60_000, onStoreFailure: "deny" }),
  validateBody(loginSchema),
  controller.login,
);

router.post(
  "/auth/refresh",
  sameOrigin,
  rateLimit({ name: "auth.refresh.ip", limit: 60, windowMs: 60_000, onStoreFailure: "deny" }),
  controller.refresh,
);

router.post("/auth/logout", sameOrigin, controller.logout);

router.post(
  "/auth/password",
  requireAuth,
  validateBody(changePasswordSchema),
  controller.changePassword,
);

router.post(
  "/auth/password/reset",
  rateLimit({
    name: "auth.password.reset.ip",
    limit: 10,
    windowMs: 60_000,
    onStoreFailure: "deny",
  }),
  validateBody(completePasswordResetSchema),
  controller.completePasswordReset,
);

router.get("/auth/sessions", requireAuth, controller.listSessions);
router.delete(
  "/auth/sessions/:sessionId",
  requireAuth,
  validateParams(sessionParamsSchema),
  controller.revokeSession,
);

router.get("/me", requireAuth, controller.me);
router.patch("/me", requireAuth, validateBody(updateProfileSchema), controller.updateProfile);

router.get("/me/avatar", requireAuth, controller.getAvatar);
router.put("/me/avatar", requireAuth, validateBody(uploadAvatarSchema), controller.setAvatar);
router.delete("/me/avatar", requireAuth, controller.removeAvatar);
