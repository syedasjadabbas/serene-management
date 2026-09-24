import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";
import type { MaintenanceStatus } from "./maintenance.policy";

/**
 * Maintenance data access (maintenance_requests, maintenance_activities,
 * maintenance_categories). Every query is scoped by property.
 */

export function findCategories(tx: Tx, propertyId: string) {
  return tx.maintenanceCategory.findMany({
    where: { propertyId, status: "ACTIVE" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export function findCategory(tx: Tx, propertyId: string, id: string) {
  return tx.maintenanceCategory.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: { id: true, code: true },
  });
}

export function findActiveRoom(tx: Tx, propertyId: string, id: string) {
  return tx.room.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: { id: true, number: true },
  });
}

export function insertRequest(tx: Tx, data: Prisma.MaintenanceRequestUncheckedCreateInput) {
  return tx.maintenanceRequest.create({ data, select: { id: true } });
}

export function insertActivity(tx: Tx, data: Prisma.MaintenanceActivityUncheckedCreateInput) {
  return tx.maintenanceActivity.create({ data, select: { id: true } });
}

export interface LockedRequestRow {
  id: string;
  request_number: string;
  room_id: string | null;
  status: MaintenanceStatus;
  priority: string;
  assigned_to_id: string | null;
  version: number;
  title: string;
}

/** Locks a request FOR UPDATE (the aggregate root of every maintenance command). */
export async function lockRequest(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<LockedRequestRow[]>`
    SELECT "id", "request_number", "room_id", "status"::text AS "status",
           "priority"::text AS "priority", "assigned_to_id", "version", "title"
    FROM "maintenance_requests"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function updateRequestVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.MaintenanceRequestUncheckedUpdateManyInput,
) {
  return tx.maintenanceRequest.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

const listSelect = {
  id: true,
  requestNumber: true,
  version: true,
  title: true,
  status: true,
  priority: true,
  location: true,
  reportedAt: true,
  resolvedAt: true,
  assignedToId: true,
  room: { select: { id: true, number: true } },
  category: { select: { id: true, code: true, name: true } },
  assignedTo: { select: { id: true, displayName: true } },
  serviceBlocks: {
    where: { status: { in: ["SCHEDULED", "ACTIVE"] } },
    select: { kind: true },
    take: 1,
  },
} as const satisfies Prisma.MaintenanceRequestSelect;

export type RequestListRow = Prisma.MaintenanceRequestGetPayload<{ select: typeof listSelect }>;

export function findRequestsPage(
  tx: Tx,
  where: Prisma.MaintenanceRequestWhereInput,
  cursor: string | null,
  take: number,
) {
  return tx.maintenanceRequest.findMany({
    where,
    // Enum order is LOW < NORMAL < HIGH < URGENT: most urgent first, oldest first.
    orderBy: [{ priority: "desc" }, { reportedAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: listSelect,
  });
}

export function findRequestDetail(tx: Tx, propertyId: string, id: string) {
  return tx.maintenanceRequest.findFirst({
    where: { id, propertyId },
    select: {
      ...listSelect,
      description: true,
      reportedById: true,
      closedAt: true,
      resolution: true,
      serviceBlocks: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, status: true, fromDate: true, toDate: true },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          body: true,
          fromStatus: true,
          toStatus: true,
          createdById: true,
          createdAt: true,
        },
      },
    },
  });
}

export function countOpenRequests(tx: Tx, propertyId: string, userId: string) {
  const active = { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as MaintenanceStatus[] };
  return Promise.all([
    tx.maintenanceRequest.groupBy({
      by: ["status"],
      where: { propertyId },
      _count: { _all: true },
    }),
    tx.maintenanceRequest.count({ where: { propertyId, status: active, assignedToId: userId } }),
    tx.maintenanceRequest.count({
      where: {
        propertyId,
        status: active,
        serviceBlocks: { some: { status: { in: ["SCHEDULED", "ACTIVE"] } } },
      },
    }),
  ]);
}
