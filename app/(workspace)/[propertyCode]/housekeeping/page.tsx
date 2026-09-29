import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { HousekeepingWorkspace } from "./components/HousekeepingWorkspace";

export const metadata: Metadata = { title: "Housekeeping" };

export default function HousekeepingPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading housekeeping" />}>
      <HousekeepingWorkspace />
    </Suspense>
  );
}
