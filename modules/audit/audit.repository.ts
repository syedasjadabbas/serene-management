import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";
import type { AuditLogQuery } from "./audit.schema";

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

export function findUserNames(tx: Tx, organizationId: string, userIds: string[]) {
  if (userIds.length === 0) return Promise.resolve([]);
  return tx.user.findMany({
    where: { organizationId, id: { in: userIds } },
    select: { id: true, displayName: true },
  });
}
