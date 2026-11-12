import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { NewReservationWorkflow } from "./_components/NewReservationWorkflow";

export const metadata: Metadata = { title: "New reservation" };

export default function NewReservationPage() {
  return (
    <PermissionGate permission={P.RESERVATIONS_CREATE}>
      <Suspense fallback={<PageSkeleton title="Loading" layout="detail" />}>
        <NewReservationWorkflow />
      </Suspense>
    </PermissionGate>
  );
}
