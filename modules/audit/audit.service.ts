import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { PropertyContext, SessionContext } from "@/lib/http/context";
import { AppError, forbidden } from "@/lib/http/errors";
import {
  type AccessProfile,
  hasOrganizationPermission,
  hasPermission,
  hasPermissionAnywhere,
  propertiesWithPermission,
} from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import type { CursorPageMeta } from "@/types/api";
import {
  findOrganizationAuditLogs,
  findPropertyAuditLogs,
  findPropertyCodes,
  findReasonCodeScope,
  findResourceHistory,
  findUserNames,
  insertAuditLog,
  insertAuditLogs,
} from "./audit.repository";
import { auditSnapshots } from "./audit.policy";
import type { AuditLogQuery, OrganizationAuditLogQuery } from "./audit.schema";
import type { AuditActor, AuditEntry, AuditLogView, OrganizationAuditLogView } from "./audit.types";

/**
 * Writes an audit record inside the caller's transaction, so the record and
 * the change it describes commit or roll back together. The table is
 * append-only (database trigger); there is deliberately no update/delete API.
 */
export async function recordAudit(tx: Tx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  if (entry.reasonCodeId) {
    await assertReasonCodeInScope(tx, actor, entry.reasonCodeId);
  }
  await insertAuditLog(tx, auditRow(actor, entry));
}

/**
 * Many audit records in one statement, built exactly like `recordAudit`
 * (night audit batch, M8). Same transaction semantics.
 */
export async function recordAuditMany(
  tx: Tx,
  items: { actor: AuditActor; entry: AuditEntry }[],
): Promise<void> {
  if (items.length === 0) return;
  for (const { actor, entry } of items) {
    if (entry.reasonCodeId) await assertReasonCodeInScope(tx, actor, entry.reasonCodeId);
  }
  await insertAuditLogs(
    tx,
    items.map(({ actor, entry }) => auditRow(actor, entry)),
  );
}

function auditRow(actor: AuditActor, entry: AuditEntry) {
  const after =
    entry.permission === undefined
      ? entry.after
      : {
          ...(isPlainObject(entry.after) ? entry.after : { value: entry.after }),
          meta: { permission: entry.permission },
        };
  return {
    organizationId: actor.organizationId,
    propertyId: actor.propertyId ?? null,
    userId: actor.userId ?? null,
    actorType: actor.actorType ?? (actor.userId ? "USER" : "SYSTEM"),
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    businessDate: actor.businessDate ? new Date(`${actor.businessDate}T00:00:00.000Z`) : null,
    risk: entry.risk ?? "STANDARD",
    before: toJson(entry.before),
    after: toJson(after),
    reasonCodeId: entry.reasonCodeId ?? null,
    reason: entry.reason ?? null,
    requestId: actor.requestId ?? null,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

/** Reads a property's audit trail (newest first, keyset pagination). */
export async function listPropertyAuditLogs(
  organizationId: string,
  propertyId: string,
  query: AuditLogQuery,
  /** Whether the caller holds billing:read at the property (M1: redaction otherwise). */
  financialVisible: boolean,
  /** Whether the caller may read guest profiles (L9: guest contact details otherwise hidden). */
  personalVisible = true,
): Promise<{ items: AuditLogView[]; meta: CursorPageMeta }> {
  let after: { createdAt: Date; id: string } | null = null;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, ["c", "i"] as const, { c: "timestamp" });
    const createdAt = decoded ? new Date(decoded.c) : null;
    if (!decoded || !createdAt || Number.isNaN(createdAt.getTime())) {
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
    after = { createdAt, id: decoded.i };
  }

  const rows = await findPropertyAuditLogs(prisma, propertyId, query, after);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id })
      : null;

  const userIds = [
    ...new Set(page.map((row) => row.userId).filter((id): id is string => id !== null)),
  ];
  const names = new Map(
    (await findUserNames(prisma, organizationId, userIds)).map((user) => [
      user.id,
      user.displayName,
    ]),
  );

  return {
    items: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      risk: row.risk,
      userId: row.userId,
      userDisplayName: row.userId ? (names.get(row.userId) ?? null) : null,
      businessDate: row.businessDate ? toDateOnly(row.businessDate) : null,
      reason: row.reason,
      requestId: row.requestId,
      ...auditSnapshots(row, financialVisible, personalVisible),
    })),
    meta: { nextCursor, limit: query.limit },
  };
}

/**
 * Whether billing data of an audit row's scope is visible to the caller:
 * `billing:read` at the row's property, or at organization scope for
 * organization-level rows (M1, D54).
 */
export function financialVisibleFor(access: AccessProfile) {
  return (propertyId: string | null) =>
    propertyId === null
      ? hasOrganizationPermission(access, "billing:read")
      : hasPermission(access, propertyId, "billing:read");
}

/**
 * Organization audit trail (Phase 9, G4): newest first across the caller's
 * audit scope — properties where they hold `audit:read`, and
 * organization-level rows (users, guests, companies, loyalty, properties)
 * only with `audit:read` at organization level (G3).
 */
export async function listOrganizationAuditLogs(
  ctx: SessionContext,
  query: OrganizationAuditLogQuery,
): Promise<{ items: OrganizationAuditLogView[]; meta: CursorPageMeta }> {
  let propertyIds = propertiesWithPermission(ctx.access, "audit:read");
  let includeOrganization = hasOrganizationPermission(ctx.access, "audit:read");
  if (propertyIds.length === 0 && !includeOrganization) throw forbidden("audit:read");
  if (query.scope === "organization") {
    if (!includeOrganization) throw forbidden("audit:read");
    propertyIds = [];
  } else if (query.scope) {
    // An inaccessible property is indistinguishable from a missing one.
    if (!propertyIds.includes(query.scope)) {
      throw new AppError("FORBIDDEN", "You do not have access to this property");
    }
    propertyIds = [query.scope];
    includeOrganization = false;
  }

  let after: { createdAt: Date; id: string } | null = null;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, ["c", "i"] as const, { c: "timestamp" });
    const createdAt = decoded ? new Date(decoded.c) : null;
    if (!decoded || !createdAt || Number.isNaN(createdAt.getTime())) {
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
    after = { createdAt, id: decoded.i };
  }

  const rows = await findOrganizationAuditLogs(
    prisma,
    { organizationId: ctx.organizationId, propertyIds, includeOrganization },
    query,
    after,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id })
      : null;
  const names = await userDisplayNames(
    prisma,
    ctx.organizationId,
    page.map((row) => row.userId).filter((id): id is string => id !== null),
  );
  const codes = new Map(
    (
      await findPropertyCodes(prisma, ctx.organizationId, [
        ...new Set(page.map((r) => r.propertyId).filter((id): id is string => !!id)),
      ])
    ).map((p) => [p.id, p.code]),
  );
  const financialVisible = financialVisibleFor(ctx.access);
  const personalVisible = hasPermissionAnywhere(ctx.access, "guests:read");
  return {
    items: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      risk: row.risk,
      userId: row.userId,
      userDisplayName: row.userId ? (names.get(row.userId) ?? null) : null,
      businessDate: row.businessDate ? toDateOnly(row.businessDate) : null,
      reason: row.reason,
      requestId: row.requestId,
      ...auditSnapshots(row, financialVisible(row.propertyId), personalVisible),
      property: row.propertyId
        ? { id: row.propertyId, code: codes.get(row.propertyId) ?? "" }
        : null,
    })),
    meta: { nextCursor, limit: query.limit },
  };
}

/**
 * A structured reason code on an audit row must be a real code of the row's
 * scope (L7): the row's property, or for organization-level rows a property
 * of the organization. Optional codes stay optional; an arbitrary or foreign
 * id is refused (the whole command rolls back) instead of being recorded as
 * misleading metadata. Reason codes are property configuration (no foreign
 * key on audit_logs, which is append-only and outlives configuration).
 */
async function assertReasonCodeInScope(tx: Tx, actor: AuditActor, reasonCodeId: string) {
  const code = await findReasonCodeScope(tx, reasonCodeId);
  const inScope =
    code !== null &&
    code.property.organizationId === actor.organizationId &&
    (actor.propertyId == null || code.propertyId === actor.propertyId);
  if (!inScope) {
    throw new AppError("VALIDATION_FAILED", "Unknown reason code", {
      fields: { reasonCodeId: ["Choose a reason code of this property"] },
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface ResourceHistoryEntry {
  id: string;
  at: string;
  action: string;
  userId: string | null;
  userDisplayName: string | null;
  risk: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

/**
 * Newest-first audit entries for the given resources, with actor names.
 * Only rows the caller may inspect (G3): rows written at a property need
 * `audit:read` at that property; organization-level rows (property null)
 * need `audit:read` at organization level.
 */
export async function resourceHistory(
  tx: Tx,
  ctx: SessionContext,
  resourceIds: string[],
  take = 100,
): Promise<ResourceHistoryEntry[]> {
  if (resourceIds.length === 0) return [];
  const organizationId = ctx.organizationId;
  const scope = {
    organizationId,
    propertyIds: propertiesWithPermission(ctx.access, "audit:read"),
    includeOrganization: hasOrganizationPermission(ctx.access, "audit:read"),
  };
  if (scope.propertyIds.length === 0 && !scope.includeOrganization) return [];
  return historyEntries(tx, scope, resourceIds, take, financialVisibleFor(ctx.access));
}

/**
 * History of a property's own resources (reservation, stay) as the property
 * workspace shows it to its staff: only rows written at that property.
 */
export async function propertyResourceHistory(
  tx: Tx,
  ctx: PropertyContext,
  resourceIds: string[],
  take = 100,
): Promise<ResourceHistoryEntry[]> {
  if (resourceIds.length === 0) return [];
  return historyEntries(
    tx,
    {
      organizationId: ctx.organizationId,
      propertyIds: [ctx.propertyId],
      includeOrganization: false,
    },
    resourceIds,
    take,
    financialVisibleFor(ctx.access),
  );
}

async function historyEntries(
  tx: Tx,
  scope: { organizationId: string; propertyIds: string[]; includeOrganization: boolean },
  resourceIds: string[],
  take: number,
  financialVisible: (propertyId: string | null) => boolean,
): Promise<ResourceHistoryEntry[]> {
  const organizationId = scope.organizationId;
  const rows = await findResourceHistory(tx, scope, resourceIds, take);
  const names = await userDisplayNames(
    tx,
    organizationId,
    rows.map((r) => r.userId).filter((id): id is string => !!id),
  );
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt.toISOString(),
    action: row.action,
    userId: row.userId,
    userDisplayName: row.userId ? (names.get(row.userId) ?? null) : null,
    risk: row.risk,
    reason: row.reason,
    ...auditSnapshots(row, financialVisible(row.propertyId)),
  }));
}

/** Display names of users of the organization, by id. */
export async function userDisplayNames(
  tx: Tx,
  organizationId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const rows = await findUserNames(tx, organizationId, [...new Set(userIds)]);
  return new Map(rows.map((u) => [u.id, u.displayName]));
}
