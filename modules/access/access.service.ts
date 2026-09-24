import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { type Permission, isPermission } from "@/lib/permissions/catalog";
import type { AccessProfile } from "@/lib/permissions/evaluate";
import type { AccessTokenClaims } from "@/lib/auth/tokens";
import {
  findActiveProperties,
  findGrantedPermissions,
  findSessionWithUser,
  findSystemRoleTemplates,
  findUsersWithPermission,
  insertOrganization,
  insertOrganizationRole,
} from "./access.repository";
import type { MeView, PropertySummary } from "./access.types";

export interface ResolvedSession {
  sessionId: string;
  user: MeView["user"] & { organizationId: string; defaultPropertyId: string | null };
  organization: MeView["organization"];
  access: AccessProfile;
  properties: PropertySummary[];
}

/**
 * Turns verified access-token claims into the caller's identity and effective
 * permissions. Returns null when the session was revoked or expired, the user
 * is no longer active, or the token does not match the stored session — so
 * logout, disabling a user and role changes apply on the very next request.
 * Three indexed queries, no per-property loops.
 */
export async function resolveSession(
  claims: AccessTokenClaims,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  const session = await findSessionWithUser(prisma, claims.sessionId);
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const { user } = session;
  if (user.id !== claims.userId || user.organizationId !== claims.organizationId) return null;
  if (user.status !== "ACTIVE" || user.organization.status !== "ACTIVE") return null;

  const grants = await findGrantedPermissions(prisma, user.id, user.organizationId);

  const organizationPermissions = new Set<Permission>();
  const propertyGrants = new Map<string, Set<Permission>>();
  for (const grant of grants) {
    if (!isPermission(grant.permission_key)) continue;
    if (grant.scope === "ORGANIZATION") {
      organizationPermissions.add(grant.permission_key);
    } else if (grant.property_id) {
      const set = propertyGrants.get(grant.property_id) ?? new Set<Permission>();
      set.add(grant.permission_key);
      propertyGrants.set(grant.property_id, set);
    }
  }

  // Organization-wide grants (or super admin) cover every active property of the organization.
  const coversAllProperties = user.isSuperAdmin || organizationPermissions.size > 0;
  const properties = await findActiveProperties(
    prisma,
    user.organizationId,
    coversAllProperties ? "ALL" : [...propertyGrants.keys()],
  );

  const byProperty: Record<string, Permission[]> = {};
  for (const property of properties) {
    const merged = new Set(organizationPermissions);
    for (const permission of propertyGrants.get(property.id) ?? []) merged.add(permission);
    byProperty[property.id] = [...merged].sort();
  }

  return {
    sessionId: session.id,
    user: {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      isSuperAdmin: user.isSuperAdmin,
      defaultPropertyId: user.defaultPropertyId,
    },
    organization: {
      id: user.organization.id,
      code: user.organization.code,
      name: user.organization.name,
      baseCurrency: user.organization.baseCurrency,
    },
    access: {
      userId: user.id,
      organizationId: user.organizationId,
      isSuperAdmin: user.isSuperAdmin,
      organizationPermissions: [...organizationPermissions].sort(),
      byProperty,
    },
    properties,
  };
}

export function toMeView(session: ResolvedSession): MeView {
  const defaultProperty =
    session.properties.find((p) => p.id === session.user.defaultPropertyId) ??
    session.properties[0];
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      locale: session.user.locale,
      isSuperAdmin: session.user.isSuperAdmin,
    },
    organization: session.organization,
    organizationPermissions: [...session.access.organizationPermissions],
    properties: session.properties.map((property) => ({
      ...property,
      permissions: [...(session.access.byProperty[property.id] ?? [])],
    })),
    defaultPropertyCode: defaultProperty?.code ?? null,
  };
}

/**
 * Platform operation (seed, onboarding): creates an organization and copies
 * every system role template into it as an editable organization role
 * (docs/RBAC.md §1). Requires the permission catalog and templates to be seeded.
 */
export async function bootstrapOrganization(
  tx: Tx,
  input: { code: string; name: string; legalName?: string; baseCurrency: string },
): Promise<{ id: string; roleIdsByCode: Record<string, string> }> {
  const templates = await findSystemRoleTemplates(tx);
  if (templates.length === 0)
    throw new Error("System role templates are missing; run the reference seed first");
  const organization = await insertOrganization(tx, {
    code: input.code,
    name: input.name,
    legalName: input.legalName ?? null,
    baseCurrency: input.baseCurrency,
  });
  const roleIdsByCode: Record<string, string> = {};
  for (const template of templates) {
    const role = await insertOrganizationRole(tx, organization.id, {
      code: template.code,
      name: template.name,
      description: template.description,
      permissionKeys: template.permissions.map((p) => p.permissionKey),
    });
    roleIdsByCode[role.code] = role.id;
  }
  return { id: organization.id, roleIdsByCode };
}

/** Health check: one trivial round trip to PostgreSQL. */
export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Users who hold `permission` at the property (assignment targets for
 * housekeeping and maintenance work). Authorization stays permission-based:
 * no role names are involved.
 */
export async function usersWithPermission(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  permission: Permission,
): Promise<{ id: string; displayName: string }[]> {
  const rows = await findUsersWithPermission(tx, organizationId, propertyId, permission, null);
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

/** Whether a user of the organization holds `permission` at the property. */
export async function userHasPermission(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  userId: string,
  permission: Permission,
): Promise<{ id: string; displayName: string } | null> {
  const rows = await findUsersWithPermission(tx, organizationId, propertyId, permission, userId);
  const row = rows[0];
  return row ? { id: row.id, displayName: row.display_name } : null;
}
