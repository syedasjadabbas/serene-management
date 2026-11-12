import type { RequestHandler } from "express";
import { appError } from "@/lib/customError";
import { inspectAccessToken } from "@/lib/jwt";
import { resolveSessionCached } from "@/lib/sessions";
import type { SessionContext } from "@/lib/context";

/** 401 reason codes (`error.details.reason`): the client shows the server's message. */
const MESSAGES = {
  TOKEN_MISSING: "Please sign in to continue.",
  TOKEN_INVALID: "Your session is not valid. Please sign in again.",
  TOKEN_EXPIRED: "Your session has expired. Please sign in again.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  SESSION_REVOKED: "You have been signed out. Please sign in again.",
  ACCOUNT_DISABLED: "Your account is not active. Contact an administrator.",
} as const;

export type UnauthenticatedReason = keyof typeof MESSAGES;

export function unauthenticated(reason: UnauthenticatedReason) {
  return appError("UNAUTHENTICATED", MESSAGES[reason], { reason });
}

/**
 * `Authorization: Bearer <access JWT>` -> verified claims (`sub`, `org`,
 * `sid`) -> session (session cache, then permission cache; lib/sessions.ts) ->
 * `req.ctx` (SessionContext) and `req.auth` (the resolved identity). Refused
 * with 401 UNAUTHENTICATED and `details.reason` in TOKEN_MISSING,
 * TOKEN_INVALID, TOKEN_EXPIRED (the access token only: refresh and retry),
 * SESSION_EXPIRED, SESSION_REVOKED, ACCOUNT_DISABLED.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const verified = await inspectAccessToken(bearer);
  if ("rejected" in verified) throw unauthenticated(verified.rejected);

  const resolved = await resolveSessionCached(verified.claims);
  if (!resolved.ok) throw unauthenticated(resolved.reason);

  const { session } = resolved;
  const ctx: SessionContext = {
    ...req.meta,
    userId: session.user.id,
    organizationId: session.user.organizationId,
    sessionId: session.sessionId,
    access: session.access,
  };
  req.ctx = ctx;
  req.auth = session;
  next();
};
