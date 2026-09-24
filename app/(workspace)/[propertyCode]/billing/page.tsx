import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { BillingWorkspace } from "./components/BillingWorkspace";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading billing" />}>
      <BillingWorkspace />
    </Suspense>
  );
}
