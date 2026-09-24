import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

export function findSessionWithUser(tx: Tx, sessionId: string) {
  return tx.authSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          organizationId: true,
          email: true,
          displayName: true,
          locale: true,
          status: true,
          isSuperAdmin: true,
          defaultPropertyId: true,
          organization: {
            select: { id: true, code: true, name: true, baseCurrency: true, status: true },
          },
        },
      },
    },
  });
}

/**
 * All (scope, property, permission) grants of a user in one query. Only roles
 * of the user's own organization count; grants on inactive properties are
 * ignored.
 */
export function findGrantedPermissions(tx: Tx, userId: string, organizationId: string) {
  return tx.$queryRaw<
    { scope: "ORGANIZATION" | "PROPERTY"; property_id: string | null; permission_key: string }[]
  >`
    SELECT DISTINCT a."scope"::text AS "scope", a."property_id", rp."permission_key"
    FROM "user_role_assignments" a
    JOIN "roles" r ON r."id" = a."role_id"
    JOIN "role_permissions" rp ON rp."role_id" = r."id"
    LEFT JOIN "properties" p ON p."id" = a."property_id"
    WHERE a."user_id" = ${userId}::uuid
      AND (r."organization_id" = ${organizationId}::uuid OR r."organization_id" IS NULL)
      AND (a."property_id" IS NULL OR (p."organization_id" = ${organizationId}::uuid AND p."status" = 'ACTIVE'))`;
}

/**
 * Active users of the organization holding `permission` at the property,
 * through an organization-wide or a property-scoped role grant.
 */
export function findUsersWithPermission(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  permission: string,
  userId: string | null,
) {
  return tx.$queryRaw<{ id: string; display_name: string }[]>`
    SELECT DISTINCT u."id", u."display_name"
    FROM "users" u
    JOIN "user_role_assignments" a ON a."user_id" = u."id"
    JOIN "roles" r ON r."id" = a."role_id"
    JOIN "role_permissions" rp ON rp."role_id" = r."id"
    WHERE u."organization_id" = ${organizationId}::uuid
      AND u."status" = 'ACTIVE'
      AND (r."organization_id" = ${organizationId}::uuid OR r."organization_id" IS NULL)
      AND rp."permission_key" = ${permission}
      AND (a."property_id" IS NULL OR a."property_id" = ${propertyId}::uuid)
      ${userId ? Prisma.sql`AND u."id" = ${userId}::uuid` : Prisma.empty}
    ORDER BY u."display_name"
    LIMIT 500`;
}

export function findActiveProperties(tx: Tx, organizationId: string, ids: string[] | "ALL") {
  return tx.property.findMany({
    where: { organizationId, status: "ACTIVE", ...(ids === "ALL" ? {} : { id: { in: ids } }) },
    select: { id: true, code: true, name: true, timezone: true, currencyCode: true },
    orderBy: { code: "asc" },
  });
}

export function insertOrganization(
  tx: Tx,
  data: { code: string; name: string; legalName: string | null; baseCurrency: string },
) {
  return tx.organization.create({ data, select: { id: true, code: true, name: true } });
}

export function findSystemRoleTemplates(tx: Tx) {
  return tx.role.findMany({
    where: { organizationId: null, isSystem: true },
    select: {
      code: true,
      name: true,
      description: true,
      permissions: { select: { permissionKey: true } },
    },
  });
}

export async function insertOrganizationRole(
  tx: Tx,
  organizationId: string,
  role: { code: string; name: string; description: string | null; permissionKeys: string[] },
) {
  const created = await tx.role.create({
    data: {
      organizationId,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: false,
    },
    select: { id: true, code: true },
  });
  if (role.permissionKeys.length > 0) {
    await tx.rolePermission.createMany({
      data: role.permissionKeys.map((permissionKey) => ({ roleId: created.id, permissionKey })),
    });
  }
  return created;
}
