import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { PropertyContext, SessionContext } from "@/lib/http/context";
import { AppError, forbidden } from "@/lib/http/errors";
import { hasOrganizationPermission, propertiesWithPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import type { CursorPageMeta } from "@/types/api";
import {
  findOrganizationAuditLogs,
  findPropertyAuditLogs,
  findPropertyCodes,
  findResourceHistory,
  findUserNames,
  insertAuditLog,
} from "./audit.repository";
import type { AuditLogQuery, OrganizationAuditLogQuery } from "./audit.schema";
import type { AuditActor, AuditEntry, AuditLogView, OrganizationAuditLogView } from "./audit.types";

/**
 * Writes an audit record inside the caller's transaction, so the record and
 * the change it describes commit or roll back together. The table is
 * append-only (database trigger); there is deliberately no update/delete API.
 */
export async function recordAudit(tx: Tx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  const after =
    entry.permission === undefined
      ? entry.after
      : {
          ...(isPlainObject(entry.after) ? entry.after : { value: entry.after }),
          meta: { permission: entry.permission },
        };

  await insertAuditLog(tx, {
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
  });
}

/** Reads a property's audit trail (newest first, keyset pagination). */
export async function listPropertyAuditLogs(
  organizationId: string,
  propertyId: string,
  query: AuditLogQuery,
): Promise<{ items: AuditLogView[]; meta: CursorPageMeta }> {
  let after: { createdAt: Date; id: string } | null = null;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, ["c", "i"] as const);
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
      before: row.before,
      after: row.after,
    })),
    meta: { nextCursor, limit: query.limit },
  };
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
    const decoded = decodeCursor(query.cursor, ["c", "i"] as const);
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
      before: row.before,
      after: row.after,
      property: row.propertyId
        ? { id: row.propertyId, code: codes.get(row.propertyId) ?? "" }
        : null,
    })),
    meta: { nextCursor, limit: query.limit },
  };
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
  return historyEntries(tx, scope, resourceIds, take);
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
  );
}

async function historyEntries(
  tx: Tx,
  scope: { organizationId: string; propertyIds: string[]; includeOrganization: boolean },
  resourceIds: string[],
  take: number,
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
    before: row.before,
    after: row.after,
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
