import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { FolioWorkspace } from "./_components/FolioWorkspace";

export const metadata: Metadata = { title: "Folio" };

export default async function FolioPage({
  params,
}: {
  params: Promise<{ propertyCode: string; reservationRoomId: string }>;
}) {
  const { reservationRoomId } = await params;
  return (
    <PermissionGate permission={P.BILLING_READ}>
      <FolioWorkspace reservationRoomId={reservationRoomId} />
    </PermissionGate>
  );
}
