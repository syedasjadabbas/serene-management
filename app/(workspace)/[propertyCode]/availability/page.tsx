import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { AvailabilityWorkspace } from "./components/AvailabilityWorkspace";

export const metadata: Metadata = { title: "Availability" };

export default function AvailabilityPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading availability" />}>
      <AvailabilityWorkspace />
    </Suspense>
  );
}
