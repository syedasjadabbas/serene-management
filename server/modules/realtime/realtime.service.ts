import { decodeJwt } from "jose";
import type { Request, Response } from "express";
import { serverEnv } from "@/config/env";
import type { PropertyContext } from "@/lib/context";
import { hasPermission } from "@serene/shared/lib/permissions/evaluate";
import { realtimeHub } from "@/lib/realtime/hub";
import { STREAM_MAX_MS, openEventStream } from "@/lib/realtime/stream";
import { topicsFor } from "@serene/shared/lib/realtime/topics";
import { isDraining } from "@/lib/lifecycle/shutdown";

/**
 * Live updates of one property for the signed-in user (docs/SCALABILITY.md
 * §31). The route has already authenticated the session and checked access
 * to the property; the topics are the ones this user may read there. The
 * stream ends when the access token expires (the client refreshes it and
 * reconnects) or when the session, the user's roles or the property change.
 */
export function openPropertyEvents(ctx: PropertyContext, req: Request, res: Response): void {
  // Switched off: 204 tells an event-stream client not to reconnect; the
  // screens keep polling.
  if (serverEnv().REALTIME_ENABLED === "0") {
    res.status(204).end();
    return;
  }
  // Shutting down: no new streams here; the client retries with backoff and
  // the load balancer sends it to another instance.
  if (isDraining()) {
    res.status(503).setHeader("retry-after", "1");
    res.end();
    return;
  }

  const topics = topicsFor((permission) => hasPermission(ctx.access, ctx.propertyId, permission));
  // The token was verified by requireAuth; only its expiry is read here.
  let endsAt = Date.now() + STREAM_MAX_MS;
  const token = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "")?.[1];
  if (token) {
    const expiry = decodeJwt(token).exp;
    if (typeof expiry === "number") endsAt = Math.min(endsAt, expiry * 1000);
  }
  openEventStream(
    realtimeHub(),
    {
      propertyId: ctx.propertyId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      topics,
    },
    { req, res, endsAt },
  );
}
