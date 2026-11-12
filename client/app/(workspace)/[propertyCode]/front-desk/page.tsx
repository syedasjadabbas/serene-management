import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { FrontDeskWorkspace } from "./_components/FrontDeskWorkspace";

export const metadata: Metadata = { title: "Front desk" };

export default function FrontDeskPage() {
  return (
    <PermissionGate permission={P.FRONTDESK_READ}>
      <Suspense fallback={<PageSkeleton title="Loading front desk" />}>
        <FrontDeskWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
