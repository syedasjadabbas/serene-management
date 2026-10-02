import "server-only";
import { decodeJwt } from "jose";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { serverEnv } from "@/lib/env";
import type { PropertyContext } from "@/lib/http/context";
import { hasPermission } from "@/lib/permissions/evaluate";
import { realtimeHub } from "@/lib/realtime/hub";
import { STREAM_MAX_MS, openEventStream } from "@/lib/realtime/stream";
import { topicsFor } from "@/lib/realtime/topics";
import { isDraining } from "@/lib/lifecycle/shutdown";

/**
 * Live updates of one property for the signed-in user (docs/SCALABILITY.md
 * §31). The route has already authenticated the session and checked access
 * to the property; the topics are the ones this user may read there. The
 * stream ends when the access token expires (the client refreshes it and
 * reconnects) or when the session, the user's roles or the property change.
 */
export function openPropertyEvents(ctx: PropertyContext, request: NextRequest): Response {
  // Switched off: 204 tells an event-stream client not to reconnect; the
  // screens keep polling.
  if (serverEnv().REALTIME_ENABLED === "0") return new Response(null, { status: 204 });
  // Shutting down: no new streams here; the client retries with backoff and
  // the load balancer sends it to another instance.
  if (isDraining()) return new Response(null, { status: 503, headers: { "retry-after": "1" } });

  const topics = topicsFor((permission) => hasPermission(ctx.access, ctx.propertyId, permission));
  // The token was verified by the route; only its expiry is read here.
  let endsAt = Date.now() + STREAM_MAX_MS;
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (token) {
    const expiry = decodeJwt(token).exp;
    if (typeof expiry === "number") endsAt = Math.min(endsAt, expiry * 1000);
  }
  return openEventStream(
    realtimeHub(),
    {
      propertyId: ctx.propertyId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      topics,
    },
    { signal: request.signal, endsAt },
  );
}
