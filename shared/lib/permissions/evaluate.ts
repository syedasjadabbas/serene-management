import type { Permission } from "./catalog";

/**
 * Effective access of one user, resolved server-side from role assignments
 * (docs/RBAC.md). Isomorphic so the UI can mirror decisions from `GET /me`,
 * but only the server's evaluation is authoritative.
 *
 * - `organizationPermissions`: grants from ORGANIZATION-scope roles. They
 *   authorize organization-level actions (users, properties, central config).
 * - `byProperty`: for every accessible property, the union of organization
 *   grants and that property's PROPERTY-scope grants. A property absent from
 *   this map is inaccessible.
 */
export interface AccessProfile {
  userId: string;
  organizationId: string;
  isSuperAdmin: boolean;
  organizationPermissions: readonly Permission[];
  byProperty: Readonly<Record<string, readonly Permission[]>>;
}

export function canAccessProperty(access: AccessProfile, propertyId: string): boolean {
  return Object.hasOwn(access.byProperty, propertyId);
}

export function hasPermission(
  access: AccessProfile,
  propertyId: string,
  permission: Permission,
): boolean {
  if (!canAccessProperty(access, propertyId)) return false;
  if (access.isSuperAdmin) return true;
  return access.byProperty[propertyId]?.includes(permission) ?? false;
}

export function hasAnyPermission(
  access: AccessProfile,
  propertyId: string,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(access, propertyId, permission));
}

export function hasOrganizationPermission(access: AccessProfile, permission: Permission): boolean {
  return access.isSuperAdmin || access.organizationPermissions.includes(permission);
}

/** True when the permission is granted at organization level or at any accessible property. */
export function hasPermissionAnywhere(access: AccessProfile, permission: Permission): boolean {
  if (hasOrganizationPermission(access, permission)) return true;
  return Object.values(access.byProperty).some((permissions) => permissions.includes(permission));
}

/** Permissions the user holds in a scope (organization when propertyId is null). */
export function permissionsInScope(
  access: AccessProfile,
  propertyId: string | null,
): readonly Permission[] {
  if (propertyId === null) return access.organizationPermissions;
  return access.byProperty[propertyId] ?? [];
}

/**
 * Accessible properties where the user holds the permission. Organization data
 * (guest and company profiles) is shown with property facts — history,
 * balances, property notes — only from these properties (docs/RBAC.md §5).
 */
export function propertiesWithPermission(access: AccessProfile, permission: Permission): string[] {
  return Object.keys(access.byProperty).filter((propertyId) =>
    hasPermission(access, propertyId, permission),
  );
}
