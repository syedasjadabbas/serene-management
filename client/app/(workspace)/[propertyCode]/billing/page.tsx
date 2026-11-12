import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { BillingWorkspace } from "./_components/BillingWorkspace";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading billing" />}>
      <BillingWorkspace />
    </Suspense>
  );
}
