import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { HousekeepingWorkspace } from "./components/HousekeepingWorkspace";

export const metadata: Metadata = { title: "Housekeeping" };

export default function HousekeepingPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading housekeeping" />}>
      <HousekeepingWorkspace />
    </Suspense>
  );
}
