"use client";

import { useMeQuery } from "@/global/api/endpoints/sessionApi";
import type { Permission } from "@serene/shared/lib/permissions/catalog";
import { useHydrated } from "./useHydrated";
import { useOptionalProperty } from "./useProperty";

/**
 * UI gating only (hide/disable actions). The server re-checks every request;
 * never treat this as authorization.
 *
 * `scope` is the property the checks apply to: a property id, `null` for the
 * organization level, or omitted for the property of the current URL (the
 * organization level outside a property workspace).
 *
 * - `has(permission, propertyId?)`: the permission at that property (default:
 *   the hook's scope); `null` asks for the organization level.
 * - `can(permission)`: the same for the hook's scope.
 */
export function usePermissions(scope?: string | null) {
  const { data, isLoading } = useMeQuery();
  const hydrated = useHydrated();
  const current = useOptionalProperty();
  const me = hydrated ? data : undefined;
  const defaultScope = scope === undefined ? (current?.id ?? null) : scope;
  const isSuperAdmin = me?.user.isSuperAdmin ?? false;

  const has = (permission: Permission, propertyId: string | null = defaultScope) => {
    if (isSuperAdmin) return true;
    const granted =
      propertyId === null
        ? me?.organizationPermissions
        : me?.properties.find((p) => p.id === propertyId)?.permissions;
    return granted?.includes(permission) ?? false;
  };

  return {
    isLoading: isLoading || !hydrated,
    has,
    can: (permission: Permission) => has(permission),
  };
}
