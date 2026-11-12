"use client";

import type { ReactNode } from "react";
import type { Permission } from "@serene/shared/lib/permissions/catalog";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { usePermissions } from "@/global/hooks/usePermissions";

/**
 * Renders `children` only when the signed-in user holds `permission` (a list
 * means any one of them) in the gate's scope: the current URL property by
 * default, the organization level with `scope="organization"` (or
 * `propertyId={null}`), or an explicit `propertyId`. Otherwise shows
 * `fallback`, by default the standard "no permission" panel. The check is
 * `usePermissions().has()`. UI only, never security: the server decides on
 * every request.
 */
export function PermissionGate({
  permission,
  scope,
  propertyId,
  fallback,
  children,
}: {
  permission: Permission | readonly Permission[];
  scope?: "property" | "organization";
  propertyId?: string | null;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { has, isLoading } = usePermissions(scope === "organization" ? null : propertyId);
  if (isLoading) return <StatusPanel kind="loading" title="Checking your access" />;
  const required = typeof permission === "string" ? [permission] : permission;
  if (required.some((key) => has(key))) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <StatusPanel
          kind="forbidden"
          title="Access denied"
          description={`You need the ${required.join(" or ")} permission.`}
        />
      )}
    </>
  );
}
