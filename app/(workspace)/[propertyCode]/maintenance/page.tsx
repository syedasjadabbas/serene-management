import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { MaintenanceWorkspace } from "./components/MaintenanceWorkspace";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading maintenance" />}>
      <MaintenanceWorkspace />
    </Suspense>
  );
}
