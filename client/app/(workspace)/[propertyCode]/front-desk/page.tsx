import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { FrontDeskWorkspace } from "./_components/FrontDeskWorkspace";

export const metadata: Metadata = { title: "Front desk" };

export default function FrontDeskPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading front desk" />}>
      <FrontDeskWorkspace />
    </Suspense>
  );
}
