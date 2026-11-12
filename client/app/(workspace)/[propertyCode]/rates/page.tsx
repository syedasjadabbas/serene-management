import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { RatesWorkspace } from "./_components/RatesWorkspace";

export const metadata: Metadata = { title: "Rates" };

export default function RatesPage() {
  return (
    <PermissionGate permission={P.RATES_READ}>
      <Suspense fallback={<PageSkeleton title="Loading rates" />}>
        <RatesWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
