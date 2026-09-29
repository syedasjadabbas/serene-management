import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { MaintenanceWorkspace } from "./components/MaintenanceWorkspace";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading maintenance" />}>
      <MaintenanceWorkspace />
    </Suspense>
  );
}
