"use client";

import { useSyncExternalStore } from "react";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import type { Permission } from "@/lib/permissions/catalog";

const noSubscribe = () => () => {};

/**
 * False while React hydrates server HTML, true afterwards (and on every
 * client-side render). A page inside a Suspense boundary can hydrate after
 * the shell's session request has already resolved; reporting "loading"
 * until hydration ends keeps that first render identical to the server's.
 */
function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

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
