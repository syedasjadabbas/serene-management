"use client";

import type { ReactNode } from "react";
import type { Permission } from "@serene/shared/lib/permissions/catalog";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { usePermissions } from "@/global/hooks/usePermissions";

/**
 * Renders `children` only when the signed-in user holds `permission` for the
 * current property (or the organization level when `propertyId` is null).
 * Otherwise shows `fallback`, by default the standard "no permission" panel.
 * UI only, never security: the server decides on every request.
 */
export function PermissionGate({
  permission,
  propertyId,
  fallback,
  children,
}: {
  permission: Permission;
  propertyId?: string | null;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { has, isLoading } = usePermissions(propertyId);
  if (isLoading) return <StatusPanel kind="loading" title="Checking your access" />;
  if (has(permission)) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <StatusPanel
          kind="forbidden"
          title="Access denied"
          description={`You need the ${permission} permission.`}
        />
      )}
    </>
  );
}
