import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { AvailabilityWorkspace } from "./_components/AvailabilityWorkspace";

export const metadata: Metadata = { title: "Availability" };

export default function AvailabilityPage() {
  return (
    <PermissionGate permission={P.AVAILABILITY_READ}>
      <Suspense fallback={<PageSkeleton title="Loading availability" />}>
        <AvailabilityWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
