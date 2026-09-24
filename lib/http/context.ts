import "server-only";
import type { AccessProfile } from "@/lib/permissions/evaluate";
import type { AuditActor } from "@/modules/audit/audit.types";

/** Transport facts about the request, available even before authentication. */
export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Replay protection for a financial command (docs/ARCHITECTURE.md §5): the
 * client's `Idempotency-Key` header, the route it was sent to and a hash of
 * the validated request, stored with the response in `idempotency_keys`.
 */
export interface IdempotencyRequest {
  key: string;
  route: string;
  requestHash: string;
}

/** An authenticated request (docs/ARCHITECTURE.md §4). */
export interface SessionContext extends RequestMeta {
  userId: string;
  organizationId: string;
  sessionId: string;
  access: AccessProfile;
}

/** An authenticated request authorized for one property (taken from the URL path only). */
export interface PropertyContext extends SessionContext {
  propertyId: string;
  propertyCode: string;
  timezone: string;
  currencyCode: string;
  /** Current business date, null until the property goes live. */
  businessDate: string | null;
}

export function auditActor(ctx: SessionContext | PropertyContext): AuditActor {
  const property = "propertyId" in ctx ? ctx : null;
  return {
    organizationId: ctx.organizationId,
    propertyId: property?.propertyId ?? null,
    businessDate: property?.businessDate ?? null,
    userId: ctx.userId,
    actorType: "USER",
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  };
}
