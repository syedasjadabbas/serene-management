import type { Metadata } from "next";
import { FolioWorkspace } from "./components/FolioWorkspace";

export const metadata: Metadata = { title: "Folio" };

export default async function FolioPage({
  params,
}: {
  params: Promise<{ propertyCode: string; reservationRoomId: string }>;
}) {
  const { reservationRoomId } = await params;
  return <FolioWorkspace reservationRoomId={reservationRoomId} />;
}
