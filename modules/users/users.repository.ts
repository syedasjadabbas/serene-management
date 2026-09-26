import "server-only";
import { Prisma } from "@/generated/prisma/client";
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

/**
 * Serializes user administration within an organization (H3): every
 * disable, enable, unlock, reset, grant and revoke takes this row lock first,
 * so two administrators can never both pass the last-administrator check.
 */
export async function lockOrganization(tx: Tx, organizationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "organizations" WHERE "id" = ${organizationId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export function findUserAuthority(tx: Tx, organizationId: string, userId: string) {
  return tx.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, status: true, isSuperAdmin: true },
  });
}

/** The organization-level administrative capabilities (discovery report H3). */
export const ADMINISTRATOR_PERMISSIONS = ["users:manage", "roles:manage", "properties:manage"];

/**
 * ACTIVE users of the organization who can administer it: platform super
 * admins, or holders of every administrator permission through
 * ORGANIZATION-scope assignments. `excludeUserId` / `excludeAssignmentId`
 * evaluate the organization as it would be after a disable / a revoke.
 */
export async function countOrganizationAdministrators(
  tx: Tx,
  organizationId: string,
  change: { excludeUserId?: string; excludeAssignmentId?: string } = {},
): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n"
    FROM "users" u
    WHERE u."organization_id" = ${organizationId}::uuid
      AND u."status" = 'ACTIVE'
      ${change.excludeUserId ? Prisma.sql`AND u."id" <> ${change.excludeUserId}::uuid` : Prisma.empty}
      AND (
        u."is_super_admin"
        OR (
          SELECT count(DISTINCT rp."permission_key")
          FROM "user_role_assignments" a
          JOIN "roles" r ON r."id" = a."role_id"
          JOIN "role_permissions" rp ON rp."role_id" = r."id"
          WHERE a."user_id" = u."id"
            AND a."scope" = 'ORGANIZATION'
            AND (r."organization_id" = ${organizationId}::uuid OR r."organization_id" IS NULL)
            AND rp."permission_key" IN (${Prisma.join(ADMINISTRATOR_PERMISSIONS)})
            ${change.excludeAssignmentId ? Prisma.sql`AND a."id" <> ${change.excludeAssignmentId}::uuid` : Prisma.empty}
        ) = ${ADMINISTRATOR_PERMISSIONS.length}
      )`;
  return rows[0]?.n ?? 0;
}
