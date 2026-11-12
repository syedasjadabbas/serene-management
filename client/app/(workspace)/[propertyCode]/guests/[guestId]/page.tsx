import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { GuestDetailView } from "./_components/GuestDetailView";

export const metadata: Metadata = { title: "Guest" };

export default async function GuestPage({
  params,
}: {
  params: Promise<{ propertyCode: string; guestId: string }>;
}) {
  const { guestId } = await params;
  return (
    <PermissionGate permission={P.GUESTS_READ}>
      <GuestDetailView guestId={guestId} />
    </PermissionGate>
  );
}
