import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { MaintenanceWorkspace } from "./_components/MaintenanceWorkspace";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <PermissionGate permission={P.MAINTENANCE_READ}>
      <Suspense fallback={<PageSkeleton title="Loading maintenance" />}>
        <MaintenanceWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
