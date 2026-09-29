import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { BillingWorkspace } from "./components/BillingWorkspace";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading billing" />}>
      <BillingWorkspace />
    </Suspense>
  );
}
