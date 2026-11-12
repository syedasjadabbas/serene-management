import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { NewReservationWorkflow } from "./_components/NewReservationWorkflow";

export const metadata: Metadata = { title: "New reservation" };

export default function NewReservationPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading" layout="detail" />}>
      <NewReservationWorkflow />
    </Suspense>
  );
}
