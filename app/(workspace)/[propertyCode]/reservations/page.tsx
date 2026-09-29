import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { ReservationSearch } from "./components/ReservationSearch";

export const metadata: Metadata = { title: "Reservations" };

export default function ReservationsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading reservations" />}>
      <ReservationSearch />
    </Suspense>
  );
}
