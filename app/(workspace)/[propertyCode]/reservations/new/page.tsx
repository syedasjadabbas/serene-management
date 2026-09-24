import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { NewReservationWorkflow } from "./components/NewReservationWorkflow";

export const metadata: Metadata = { title: "New reservation" };

export default function NewReservationPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading" />}>
      <NewReservationWorkflow />
    </Suspense>
  );
}
