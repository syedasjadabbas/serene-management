import type { Permission } from "./catalog";

/**
 * Effective access of one user, resolved server-side from role assignments
 * (docs/RBAC.md). `byProperty` holds the union of organization-wide grants
 * and that property's grants, so a check never needs a second lookup.
 */
export interface AccessProfile {
  userId: string;
  organizationId: string;
  isSuperAdmin: boolean;
  byProperty: Readonly<Record<string, readonly Permission[]>>;
}

export function canAccessProperty(access: AccessProfile, propertyId: string): boolean {
  return access.isSuperAdmin || Object.hasOwn(access.byProperty, propertyId);
}

export function hasPermission(
  access: AccessProfile,
  propertyId: string,
  permission: Permission,
): boolean {
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
