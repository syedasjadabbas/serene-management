import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { AppError } from "@/lib/http/errors";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import type { CursorPageMeta } from "@/types/api";
import {
  findPropertyAuditLogs,
  findResourceHistory,
  findUserNames,
  insertAuditLog,
} from "./audit.repository";
import type { AuditLogQuery } from "./audit.schema";
import type { AuditActor, AuditEntry, AuditLogView } from "./audit.types";

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

/** Newest-first audit entries for the given resources, with actor names (organization-scoped). */
export async function resourceHistory(
  tx: Tx,
  organizationId: string,
  resourceIds: string[],
  take = 100,
): Promise<ResourceHistoryEntry[]> {
  if (resourceIds.length === 0) return [];
  const rows = await findResourceHistory(tx, organizationId, resourceIds, take);
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
