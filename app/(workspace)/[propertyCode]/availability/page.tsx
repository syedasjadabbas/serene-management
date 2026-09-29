import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { AvailabilityWorkspace } from "./components/AvailabilityWorkspace";

export const metadata: Metadata = { title: "Availability" };

export default function AvailabilityPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading availability" />}>
      <AvailabilityWorkspace />
    </Suspense>
  );
}
