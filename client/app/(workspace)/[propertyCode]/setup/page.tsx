import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { SetupWorkspace } from "./_components/SetupWorkspace";

export const metadata: Metadata = { title: "Property setup" };

export default function SetupPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading property setup" />}>
      <SetupWorkspace />
    </Suspense>
  );
}
