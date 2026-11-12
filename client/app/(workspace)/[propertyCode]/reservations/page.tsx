import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { ReservationSearch } from "./_components/ReservationSearch";

export const metadata: Metadata = { title: "Reservations" };

export default function ReservationsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading reservations" />}>
      <ReservationSearch />
    </Suspense>
  );
}
