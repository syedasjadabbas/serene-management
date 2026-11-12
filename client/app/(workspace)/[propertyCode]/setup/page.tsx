import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { SetupWorkspace } from "./_components/SetupWorkspace";

export const metadata: Metadata = { title: "Property setup" };

export default function SetupPage() {
  return (
    <PermissionGate permission={P.SETTINGS_READ}>
      <Suspense fallback={<PageSkeleton title="Loading property setup" />}>
        <SetupWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
