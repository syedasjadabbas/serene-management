import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { SetupWorkspace } from "./components/SetupWorkspace";

export const metadata: Metadata = { title: "Property setup" };

export default function SetupPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading property setup" />}>
      <SetupWorkspace />
    </Suspense>
  );
}
