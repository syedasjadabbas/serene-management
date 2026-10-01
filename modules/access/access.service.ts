import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { logServerError } from "@/lib/http/log";
import { type Permission, isPermission } from "@/lib/permissions/catalog";
import type { AccessProfile } from "@/lib/permissions/evaluate";
import type { AccessTokenClaims } from "@/lib/auth/tokens";
import {
  type GrantRow,
  findGrantedPermissions,
  findSessionAccess,
  findSystemRoleTemplates,
  findUserAccess,
  findUsersWithPermission,
  insertOrganization,
  insertOrganizationRole,
} from "./access.repository";
import type { MeView, PropertySummary } from "./access.types";

export interface ResolvedSession {
  sessionId: string;
  user: Omit<MeView["user"], "avatarUrl"> & {
    organizationId: string;
    defaultPropertyId: string | null;
    /** Last change of the profile picture; null when the user has none. */
    avatarUpdatedAt: Date | null;
  };
  organization: MeView["organization"];
  access: AccessProfile;
  properties: PropertySummary[];
  /**
   * Current business date per accessible property, read with the properties
   * (M10). Property routes build their context from it — a request-scoped
   * value, never cached across requests.
   */
  businessDates: Record<string, string | null>;
}

/**
 * Turns verified access-token claims into the caller's identity and effective
 * permissions. Returns null when the session was revoked or expired, the user
 * is no longer active, or the token does not match the stored session — so
 * logout, disabling a user and role changes apply on the very next request.
 * One statement (session with user and organization, grants, properties
 * with their business dates: access.repository `findSessionAccess`), no
 * per-property loops, nothing cached across requests (M10, scalability phase 2).
 */
export async function resolveSession(
  claims: AccessTokenClaims,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  const session = await findSessionAccess(prisma, claims.sessionId);
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const { user } = session;
  if (user.id !== claims.userId || user.organizationId !== claims.organizationId) return null;
  if (user.status !== "ACTIVE" || user.organization.status !== "ACTIVE") return null;
  // A session opened before the current password was set is dead (H4).
  if (user.passwordChangedAt && session.createdAt < user.passwordChangedAt) return null;

  const { access, properties } = buildAccess(user, session.grants, session.properties);
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
      avatarUpdatedAt: user.avatarUpdatedAt,
    },
    organization: {
      id: user.organization.id,
      code: user.organization.code,
      name: user.organization.name,
      baseCurrency: user.organization.baseCurrency,
    },
    access,
    properties: properties.map(({ businessDate: _businessDate, ...property }) => property),
    businessDates: Object.fromEntries(properties.map((p) => [p.id, p.businessDate])),
  };
}

type ReachableProperty = PropertySummary & { businessDate: string | null };

/**
 * Effective access from grants (the exact rule; the statement returned a
 * superset of properties): organization-wide grants (or super admin) cover
 * every active property of the organization; otherwise only the properties
 * of property grants.
 */
function buildAccess(
  user: { id: string; organizationId: string; isSuperAdmin: boolean },
  grants: GrantRow[],
  reachable: ReachableProperty[],
): { access: AccessProfile; properties: ReachableProperty[] } {
  const { organizationPermissions, propertyGrants } = groupGrants(grants);
  const coversAllProperties = user.isSuperAdmin || organizationPermissions.size > 0;
  const properties = reachable.filter(
    (property) => coversAllProperties || propertyGrants.has(property.id),
  );
  const byProperty: Record<string, Permission[]> = {};
  for (const property of properties) {
    const merged = new Set(organizationPermissions);
    for (const permission of propertyGrants.get(property.id) ?? []) merged.add(permission);
    byProperty[property.id] = [...merged].sort();
  }
  return {
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

/**
 * The access a background job acts with: that of the user who started it,
 * read now (never the access they had when they asked). Null when the user
 * or the organization is no longer active, or the user cannot reach the
 * property any more.
 */
export async function resolveJobActor(
  userId: string,
  organizationId: string,
  propertyId: string,
): Promise<{ access: AccessProfile; property: ReachableProperty } | null> {
  const row = await findUserAccess(prisma, userId);
  if (!row || row.organization_id !== organizationId) return null;
  if (row.user_status !== "ACTIVE" || row.organization_status !== "ACTIVE") return null;
  const { access, properties } = buildAccess(
    { id: userId, organizationId, isSuperAdmin: row.is_super_admin },
    row.grants,
    row.properties.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      timezone: p.timezone,
      currencyCode: p.currency_code,
      businessDate: p.business_date,
    })),
  );
  const property = properties.find((p) => p.id === propertyId);
  return property ? { access, property } : null;
}

export interface GrantedPermissions {
  /** Grants from ORGANIZATION-scope role assignments. */
  organizationPermissions: Set<Permission>;
  /** Grants from PROPERTY-scope assignments, per active property of the organization. */
  propertyGrants: Map<string, Set<Permission>>;
}

/**
 * A user's grants by scope, read in the caller's transaction. Used to resolve
 * sessions and to compare two users' authority (users administration, H3).
 */
export async function loadGrantedPermissions(
  tx: Tx,
  userId: string,
  organizationId: string,
): Promise<GrantedPermissions> {
  return groupGrants(await findGrantedPermissions(tx, userId, organizationId));
}

/** Grant rows by scope; keys that are not catalog permissions are ignored. */
function groupGrants(grants: GrantRow[]): GrantedPermissions {
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
  return { organizationPermissions, propertyGrants };
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
      avatarUrl: session.user.avatarUpdatedAt
        ? `/api/v1/me/avatar?v=${session.user.avatarUpdatedAt.getTime()}`
        : null,
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

/**
 * Readiness (L28): one trivial round trip to PostgreSQL, bounded by
 * `timeoutMs` so a hung connection cannot stall the probe. Returns false on
 * any failure; the cause is logged by code only (never shown to the caller).
 */
export async function isDatabaseReady(timeoutMs = 2_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Readiness check timed out")), timeoutMs);
      }),
    ]);
    return true;
  } catch (error) {
    logServerError("Readiness check failed", error);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
