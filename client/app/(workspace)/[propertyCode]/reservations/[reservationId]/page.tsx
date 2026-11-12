import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { ReservationDetailView } from "./_components/ReservationDetailView";

export const metadata: Metadata = { title: "Reservation" };

export default async function ReservationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyCode: string; reservationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reservationId } = await params;
  const { created } = await searchParams;
  return (
    <PermissionGate permission={P.RESERVATIONS_READ}>
      <ReservationDetailView reservationId={reservationId} justCreated={created === "1"} />
    </PermissionGate>
  );
}
