import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { HousekeepingWorkspace } from "./_components/HousekeepingWorkspace";

export const metadata: Metadata = { title: "Housekeeping" };

export default function HousekeepingPage() {
  return (
    <PermissionGate permission={P.HOUSEKEEPING_READ}>
      <Suspense fallback={<PageSkeleton title="Loading housekeeping" />}>
        <HousekeepingWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
