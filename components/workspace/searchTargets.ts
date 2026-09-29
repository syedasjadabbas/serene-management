import type { Permission } from "@/lib/permissions/catalog";

/** The parts of the signed-in user's session the resolver needs (MeView). */
export interface SearchScope {
  user: { isSuperAdmin: boolean };
  /** Properties the user can access, with their effective permissions (organization grants included). */
  properties: { code: string; permissions: readonly string[] }[];
}

/**
 * The property an organization-level record (guest, company) opens in from
 * global search: only a property the user can access AND where they hold
 * the permission the record page needs there. When several qualify, the
 * lowest property code (a stable, deterministic choice). Null when none
 * does: the result is then shown as unavailable, never linked.
 */
export function profileTargetCode(scope: SearchScope, permission: Permission): string | null {
  const permitted = scope.properties
    .filter((p) => scope.user.isSuperAdmin || p.permissions.includes(permission))
    .map((p) => p.code)
    .sort();
  return permitted[0] ?? null;
}
