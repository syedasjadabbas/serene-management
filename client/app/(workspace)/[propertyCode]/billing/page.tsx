import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { BillingWorkspace } from "./_components/BillingWorkspace";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <PermissionGate permission={P.BILLING_READ}>
      <Suspense fallback={<PageSkeleton title="Loading billing" />}>
        <BillingWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
