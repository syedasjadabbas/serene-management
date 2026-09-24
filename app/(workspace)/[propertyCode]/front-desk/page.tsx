import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { FrontDeskWorkspace } from "./components/FrontDeskWorkspace";

export const metadata: Metadata = { title: "Front desk" };

export default function FrontDeskPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading front desk" />}>
      <FrontDeskWorkspace />
    </Suspense>
  );
}
