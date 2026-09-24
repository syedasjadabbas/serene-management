import type { Metadata } from "next";
import { ReservationDetailView } from "./components/ReservationDetailView";

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
  return <ReservationDetailView reservationId={reservationId} justCreated={created === "1"} />;
}
