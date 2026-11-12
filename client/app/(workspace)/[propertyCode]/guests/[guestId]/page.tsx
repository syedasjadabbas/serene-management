import type { Metadata } from "next";
import { GuestDetailView } from "./_components/GuestDetailView";

export const metadata: Metadata = { title: "Guest" };

export default async function GuestPage({
  params,
}: {
  params: Promise<{ propertyCode: string; guestId: string }>;
}) {
  const { guestId } = await params;
  return <GuestDetailView guestId={guestId} />;
}
