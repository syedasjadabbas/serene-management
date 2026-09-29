import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { RatesWorkspace } from "./components/RatesWorkspace";

export const metadata: Metadata = { title: "Rates" };

export default function RatesPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading rates" />}>
      <RatesWorkspace />
    </Suspense>
  );
}
