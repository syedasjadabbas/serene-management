import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

export interface GrantRow {
  scope: "ORGANIZATION" | "PROPERTY";
  property_id: string | null;
  permission_key: string;
}

export interface ActivePropertyRow {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currency_code: string;
  business_date: string | null;
}

/**
 * Everything an authenticated request needs, in ONE statement (scalability
 * phase 2, docs/SCALABILITY.md): the session with its user and organization,
 * the user's role grants, and the active properties those grants can reach
 * with their current business dates. It replaces three sequential round trips.
 *
 *  - grants: exactly the former grants query (roles of the user's own
 *    organization or system roles; property grants only on ACTIVE properties
 *    of that organization);
 *  - properties: ACTIVE properties of the organization that the user could
 *    reach at all (super admin, any organization-scope assignment, or an
 *    assignment at that property). This is a superset: `resolveSession` then
 *    applies the exact rule (catalog permissions only), so the result is the
 *    same as before, and the payload stays bounded by the user's reach.
 *
 * Plain scalar subqueries, no CTE: a CTE made PostgreSQL plan this statement
 * 1.5-2.5 ms per call, against ~1 ms for the three separate statements.
 * Nothing is cached: revocation, disabling, password changes and role changes
 * are read fresh on every request. No row when the session does not exist.
 */
export async function findSessionAccess(tx: Tx, sessionId: string) {
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
      avatar_updated_at: Date | null;
      organization_code: string;
      organization_name: string;
      base_currency: string;
      organization_status: "ACTIVE" | "INACTIVE";
      grants: GrantRow[];
      properties: ActivePropertyRow[];
    }[]
  >`
    SELECT s."id", s."revoked_at", s."expires_at", s."created_at",
           u."id" AS "user_id", u."organization_id", u."password_changed_at", u."email",
           u."display_name", u."locale", u."status"::text AS "user_status", u."is_super_admin",
           u."default_property_id", ua."updated_at" AS "avatar_updated_at",
           o."code" AS "organization_code", o."name" AS "organization_name",
           o."base_currency", o."status"::text AS "organization_status",
           (SELECT COALESCE(json_agg(g), '[]'::json) FROM (
              SELECT DISTINCT a."scope"::text AS "scope", a."property_id", rp."permission_key"
              FROM "user_role_assignments" a
              JOIN "roles" r ON r."id" = a."role_id"
              JOIN "role_permissions" rp ON rp."role_id" = r."id"
              LEFT JOIN "properties" p ON p."id" = a."property_id"
              WHERE a."user_id" = u."id"
                AND (r."organization_id" = u."organization_id" OR r."organization_id" IS NULL)
                AND (a."property_id" IS NULL
                     OR (p."organization_id" = u."organization_id" AND p."status" = 'ACTIVE'))
            ) g) AS "grants",
           (SELECT COALESCE(json_agg(json_build_object(
                     'id', p."id", 'code', p."code", 'name', p."name", 'timezone', p."timezone",
                     'currency_code', p."currency_code", 'business_date', bd."date"::text)
                   ORDER BY p."code"), '[]'::json)
            FROM "properties" p
            LEFT JOIN "business_dates" bd ON bd."property_id" = p."id" AND bd."is_current"
            WHERE p."organization_id" = u."organization_id" AND p."status" = 'ACTIVE'
              AND (u."is_super_admin" OR EXISTS (
                SELECT 1 FROM "user_role_assignments" a JOIN "roles" r ON r."id" = a."role_id"
                WHERE a."user_id" = u."id"
                  AND (r."organization_id" = u."organization_id" OR r."organization_id" IS NULL)
                  AND (a."property_id" IS NULL OR a."property_id" = p."id")))
           ) AS "properties"
    FROM "auth_sessions" s
    JOIN "users" u ON u."id" = s."user_id"
    JOIN "organizations" o ON o."id" = u."organization_id"
    LEFT JOIN "user_avatars" ua ON ua."user_id" = u."id"
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
      avatarUpdatedAt: row.avatar_updated_at,
      organization: {
        id: row.organization_id,
        code: row.organization_code,
        name: row.organization_name,
        baseCurrency: row.base_currency,
        status: row.organization_status,
      },
    },
    grants: row.grants,
    properties: row.properties.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      timezone: p.timezone,
      currencyCode: p.currency_code,
      businessDate: p.business_date,
    })),
  };
}

/**
 * A user's access without a session (background jobs act for the user who
 * started them, re-checked when they run): the same grants and reachable
 * properties as `findSessionAccess`, with the user's and organization's status.
 */
export async function findUserAccess(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<
    {
      organization_id: string;
      user_status: "ACTIVE" | "DISABLED" | "INVITED";
      is_super_admin: boolean;
      organization_status: "ACTIVE" | "INACTIVE";
      grants: GrantRow[];
      properties: ActivePropertyRow[];
    }[]
  >`
    SELECT u."organization_id", u."status"::text AS "user_status", u."is_super_admin",
           o."status"::text AS "organization_status",
           (SELECT COALESCE(json_agg(g), '[]'::json) FROM (
              SELECT DISTINCT a."scope"::text AS "scope", a."property_id", rp."permission_key"
              FROM "user_role_assignments" a
              JOIN "roles" r ON r."id" = a."role_id"
              JOIN "role_permissions" rp ON rp."role_id" = r."id"
              LEFT JOIN "properties" p ON p."id" = a."property_id"
              WHERE a."user_id" = u."id"
                AND (r."organization_id" = u."organization_id" OR r."organization_id" IS NULL)
                AND (a."property_id" IS NULL
                     OR (p."organization_id" = u."organization_id" AND p."status" = 'ACTIVE'))
            ) g) AS "grants",
           (SELECT COALESCE(json_agg(json_build_object(
                     'id', p."id", 'code', p."code", 'name', p."name", 'timezone', p."timezone",
                     'currency_code', p."currency_code", 'business_date', bd."date"::text)
                   ORDER BY p."code"), '[]'::json)
            FROM "properties" p
            LEFT JOIN "business_dates" bd ON bd."property_id" = p."id" AND bd."is_current"
            WHERE p."organization_id" = u."organization_id" AND p."status" = 'ACTIVE'
              AND (u."is_super_admin" OR EXISTS (
                SELECT 1 FROM "user_role_assignments" a JOIN "roles" r ON r."id" = a."role_id"
                WHERE a."user_id" = u."id"
                  AND (r."organization_id" = u."organization_id" OR r."organization_id" IS NULL)
                  AND (a."property_id" IS NULL OR a."property_id" = p."id")))
           ) AS "properties"
    FROM "users" u
    JOIN "organizations" o ON o."id" = u."organization_id"
    WHERE u."id" = ${userId}::uuid`;
  return rows[0] ?? null;
}

/**
 * All (scope, property, permission) grants of a user in one query. Only roles
 * of the user's own organization count; grants on inactive properties are
 * ignored.
 */
export function findGrantedPermissions(tx: Tx, userId: string, organizationId: string) {
  return tx.$queryRaw<GrantRow[]>`
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
