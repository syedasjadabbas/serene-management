import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { RatesWorkspace } from "./components/RatesWorkspace";

export const metadata: Metadata = { title: "Rates" };

export default function RatesPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading rates" />}>
      <RatesWorkspace />
    </Suspense>
  );
}
