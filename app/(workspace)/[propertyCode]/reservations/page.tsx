import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { ReservationSearch } from "./components/ReservationSearch";

export const metadata: Metadata = { title: "Reservations" };

export default function ReservationsPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading reservations" />}>
      <ReservationSearch />
    </Suspense>
  );
}
