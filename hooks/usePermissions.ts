"use client";

import { useMeQuery } from "@/lib/api/endpoints/session.api";
import type { Permission } from "@/lib/permissions/catalog";
import { useHydrated } from "./useHydrated";

/**
 * UI gating only (hide/disable actions). The server re-checks every request;
 * never treat this as authorization.
 */
export function usePermissions(propertyId: string | null) {
  const { data, isLoading } = useMeQuery();
  const hydrated = useHydrated();
  const me = hydrated ? data : undefined;
  const granted = new Set<Permission>(
    propertyId === null
      ? (me?.organizationPermissions ?? [])
      : (me?.properties.find((p) => p.id === propertyId)?.permissions ?? []),
  );
  const isSuperAdmin = me?.user.isSuperAdmin ?? false;
  return {
    isLoading: isLoading || !hydrated,
    can: (permission: Permission) => isSuperAdmin || granted.has(permission),
  };
}
