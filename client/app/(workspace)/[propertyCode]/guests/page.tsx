import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { GuestsWorkspace } from "./_components/GuestsWorkspace";

export const metadata: Metadata = { title: "Guests" };

export default function GuestsPage() {
  return (
    <PermissionGate permission={[P.GUESTS_READ, P.ACCOUNTS_READ, P.LOYALTY_READ]}>
      <Suspense fallback={<PageSkeleton title="Loading guests" />}>
        <GuestsWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
