import { handle, withMeta } from "@/lib/controller";
import * as service from "./users.service";

export const listRoles = handle((req) => service.listRoles(req.ctx));

export const list = handle(async (req, res) => {
  const { items, meta } = await service.listUsers(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

/** Returns the one-time set-password link. */
export const invite = handle((req) => service.inviteUser(req.ctx, req.body), { status: 201 });

export const disable = handle((req) => service.disableUser(req.ctx, req.params.userId, req.body));

/** Re-enables a disabled user; the caller must outrank the target. */
export const enable = handle((req) => service.enableUser(req.ctx, req.params.userId, req.body));

export const unlock = handle((req) => service.unlockUser(req.ctx, req.params.userId, req.body));

/** One-time password reset link: in this response only, never cached or logged. */
export const passwordReset = handle(
  (req) => service.issuePasswordReset(req.ctx, req.params.userId, req.body),
  { status: 201 },
);

export const grantRole = handle((req) => service.grantRole(req.ctx, req.params.userId, req.body), {
  status: 201,
});

export const revokeRole = handle((req) =>
  service.revokeRole(req.ctx, req.params.userId, req.params.assignmentId, req.body),
);
