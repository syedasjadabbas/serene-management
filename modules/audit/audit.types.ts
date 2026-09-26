import type { Permission } from "@/lib/permissions/catalog";

export type AuditRisk = "LOW" | "STANDARD" | "HIGH";

/** Who / where an audited action happened. Built from the request context. */
export interface AuditActor {
  organizationId: string;
  propertyId?: string | null;
  userId?: string | null;
  actorType?: "USER" | "SYSTEM";
  businessDate?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  /** `resource.verb`, e.g. "user.role_grant", "property.configuration_update". */
  action: string;
  resourceType: string;
  resourceId?: string | null;
  risk?: AuditRisk;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  reasonCodeId?: string | null;
  /** The permission that authorized the action, recorded in `after.meta`. */
  permission?: Permission;
}

/** Organization audit trail row: where it happened (null: organization level). */
export interface OrganizationAuditLogView extends AuditLogView {
  property: { id: string; code: string } | null;
}

/** Audit record as exposed by the API (never the raw table row). */
export interface AuditLogView {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  risk: AuditRisk;
  userId: string | null;
  userDisplayName: string | null;
  businessDate: string | null;
  reason: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}
