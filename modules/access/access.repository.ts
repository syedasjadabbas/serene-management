import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * The session with its user and organization in one statement (M10: this
 * runs on every authenticated request; relation loading took three).
 */
export async function findSessionWithUser(tx: Tx, sessionId: string) {
  const rows = await tx.$queryRaw<
    {
      id: string;
      revoked_at: Date | null;
      expires_at: Date;
      created_at: Date;
      user_id: string;
      organization_id: string;
      password_changed_at: Date | null;
      email: string;
      display_name: string;
      locale: string;
      user_status: "ACTIVE" | "DISABLED" | "INVITED";
      is_super_admin: boolean;
      default_property_id: string | null;
      organization_code: string;
      organization_name: string;
      base_currency: string;
      organization_status: "ACTIVE" | "INACTIVE";
    }[]
  >`
    SELECT s."id", s."revoked_at", s."expires_at", s."created_at",
           u."id" AS "user_id", u."organization_id", u."password_changed_at", u."email",
           u."display_name", u."locale", u."status"::text AS "user_status", u."is_super_admin",
           u."default_property_id",
           o."code" AS "organization_code", o."name" AS "organization_name",
           o."base_currency", o."status"::text AS "organization_status"
    FROM "auth_sessions" s
    JOIN "users" u ON u."id" = s."user_id"
    JOIN "organizations" o ON o."id" = u."organization_id"
    WHERE s."id" = ${sessionId}::uuid`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      organizationId: row.organization_id,
      passwordChangedAt: row.password_changed_at,
      email: row.email,
      displayName: row.display_name,
      locale: row.locale,
      status: row.user_status,
      isSuperAdmin: row.is_super_admin,
      defaultPropertyId: row.default_property_id,
      organization: {
        id: row.organization_id,
        code: row.organization_code,
        name: row.organization_name,
        baseCurrency: row.base_currency,
        status: row.organization_status,
      },
    },
  };
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

/**
 * Active properties the user may access, each with its current business date
 * (null before go-live) in the same statement: property requests take their
 * business date from here instead of reading it again (M10).
 */
export async function findActiveProperties(tx: Tx, organizationId: string, ids: string[] | "ALL") {
  if (ids !== "ALL" && ids.length === 0) return [];
  const rows = await tx.$queryRaw<
    {
      id: string;
      code: string;
      name: string;
      timezone: string;
      currency_code: string;
      business_date: string | null;
    }[]
  >`
    SELECT p."id", p."code", p."name", p."timezone", p."currency_code",
           bd."date"::text AS "business_date"
    FROM "properties" p
    LEFT JOIN "business_dates" bd ON bd."property_id" = p."id" AND bd."is_current"
    WHERE p."organization_id" = ${organizationId}::uuid AND p."status" = 'ACTIVE'
      ${ids === "ALL" ? Prisma.empty : Prisma.sql`AND p."id" = ANY(${ids}::uuid[])`}
    ORDER BY p."code"`;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    currencyCode: row.currency_code,
    businessDate: row.business_date,
  }));
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
