"use client";

import { useMeQuery } from "@/lib/api/endpoints/session.api";
import type { Permission } from "@/lib/permissions/catalog";

/**
 * UI gating only (hide/disable actions). The server re-checks every request;
 * never treat this as authorization.
 */
export function usePermissions(propertyId: string | null) {
  const { data: me, isLoading } = useMeQuery();
  const granted = new Set<Permission>(
    propertyId === null
      ? (me?.organizationPermissions ?? [])
      : (me?.properties.find((p) => p.id === propertyId)?.permissions ?? []),
  );
  const isSuperAdmin = me?.user.isSuperAdmin ?? false;
  return {
    isLoading,
    can: (permission: Permission) => isSuperAdmin || granted.has(permission),
  };
}
