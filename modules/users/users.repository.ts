import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

const assignmentSelect = {
  id: true,
  scope: true,
  createdAt: true,
  role: { select: { id: true, code: true, name: true } },
  property: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.UserRoleAssignmentSelect;

export const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  lockedUntil: true,
  lastLoginAt: true,
  roleAssignments: { select: assignmentSelect, orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export async function findUsersPage(
  tx: Tx,
  organizationId: string,
  page: { page: number; pageSize: number; q?: string },
) {
  const where: Prisma.UserWhereInput = {
    organizationId,
    ...(page.q
      ? {
          OR: [
            { displayName: { contains: page.q, mode: "insensitive" } },
            { email: { contains: page.q.toLowerCase() } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    tx.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    tx.user.count({ where }),
  ]);
  return { rows, total };
}

export function findUserInOrganization(tx: Tx, organizationId: string, userId: string) {
  return tx.user.findFirst({ where: { id: userId, organizationId }, select: userSelect });
}

export function findRolesWithPermissions(tx: Tx, organizationId: string) {
  return tx.role.findMany({
    where: { organizationId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      permissions: { select: { permissionKey: true } },
    },
    orderBy: { name: "asc" },
  });
}

export function findOrganizationRole(tx: Tx, organizationId: string, roleId: string) {
  return tx.role.findFirst({
    where: { id: roleId, organizationId },
    select: { id: true, code: true, name: true, permissions: { select: { permissionKey: true } } },
  });
}

export function findPropertyInOrganization(tx: Tx, organizationId: string, propertyId: string) {
  return tx.property.findFirst({
    where: { id: propertyId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
}

export function insertRoleAssignment(tx: Tx, data: Prisma.UserRoleAssignmentUncheckedCreateInput) {
  return tx.userRoleAssignment.create({ data, select: assignmentSelect });
}

export function findRoleAssignment(tx: Tx, userId: string, assignmentId: string) {
  return tx.userRoleAssignment.findFirst({
    where: { id: assignmentId, userId },
    select: {
      ...assignmentSelect,
      propertyId: true,
      role: {
        select: {
          id: true,
          code: true,
          name: true,
          permissions: { select: { permissionKey: true } },
        },
      },
    },
  });
}

export function deleteRoleAssignment(tx: Tx, assignmentId: string) {
  return tx.userRoleAssignment.delete({ where: { id: assignmentId }, select: { id: true } });
}

export function updateUserStatus(tx: Tx, userId: string, data: Prisma.UserUncheckedUpdateInput) {
  return tx.user.update({ where: { id: userId }, data, select: userSelect });
}
