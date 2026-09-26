import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";
import type { AuditLogQuery, OrganizationAuditLogQuery } from "./audit.schema";

export function insertAuditLog(tx: Tx, data: Prisma.AuditLogUncheckedCreateInput) {
  return tx.auditLog.create({ data, select: { id: true } });
}

export function findPropertyAuditLogs(
  tx: Tx,
  propertyId: string,
  query: AuditLogQuery,
  after: { createdAt: Date; id: string } | null,
) {
  return tx.auditLog.findMany({
    where: {
      propertyId,
      ...(query.risk ? { risk: query.risk } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: {
      id: true,
      createdAt: true,
      action: true,
      resourceType: true,
      resourceId: true,
      risk: true,
      userId: true,
      businessDate: true,
      reason: true,
      requestId: true,
      before: true,
      after: true,
    },
  });
}

const auditRowSelect = {
  id: true,
  createdAt: true,
  action: true,
  resourceType: true,
  resourceId: true,
  risk: true,
  userId: true,
  businessDate: true,
  reason: true,
  requestId: true,
  before: true,
  after: true,
} as const satisfies Prisma.AuditLogSelect;

/** Organization trail: only rows in the caller's audit scope (property ids / organization level). */
export function findOrganizationAuditLogs(
  tx: Tx,
  scope: { organizationId: string; propertyIds: string[]; includeOrganization: boolean },
  query: OrganizationAuditLogQuery,
  after: { createdAt: Date; id: string } | null,
) {
  const and: Prisma.AuditLogWhereInput[] = [
    {
      OR: [
        { propertyId: { in: scope.propertyIds } },
        ...(scope.includeOrganization ? [{ propertyId: null }] : []),
      ],
    },
  ];
  if (query.from) and.push({ createdAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } });
  if (query.to) {
    const end = new Date(`${query.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    and.push({ createdAt: { lt: end } });
  }
  if (after) {
    and.push({
      OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ],
    });
  }
  return tx.auditLog.findMany({
    where: {
      organizationId: scope.organizationId,
      ...(query.risk ? { risk: query.risk } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      AND: and,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: { ...auditRowSelect, propertyId: true },
  });
}

export function findPropertyCodes(tx: Tx, organizationId: string, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.property.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, code: true },
  });
}

export function findUserNames(tx: Tx, organizationId: string, userIds: string[]) {
  if (userIds.length === 0) return Promise.resolve([]);
  return tx.user.findMany({
    where: { organizationId, id: { in: userIds } },
    select: { id: true, displayName: true },
  });
}

/** Audit trail of specific resources (e.g. a stay and its reservation room), oldest first. */
export function findResourceHistory(
  tx: Tx,
  scope: { organizationId: string; propertyIds: string[]; includeOrganization: boolean },
  resourceIds: string[],
  take: number,
) {
  return tx.auditLog.findMany({
    where: {
      organizationId: scope.organizationId,
      resourceId: { in: resourceIds },
      OR: [
        { propertyId: { in: scope.propertyIds } },
        ...(scope.includeOrganization ? [{ propertyId: null }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      createdAt: true,
      action: true,
      userId: true,
      risk: true,
      reason: true,
      before: true,
      after: true,
    },
  });
}
