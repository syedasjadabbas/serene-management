import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { StayDetailView } from "./_components/StayDetailView";

export const metadata: Metadata = { title: "Stay" };

export default async function StayPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyCode: string; stayId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stayId } = await params;
  const { checkedIn } = await searchParams;
  return (
    <PermissionGate permission={P.FRONTDESK_READ}>
      <StayDetailView stayId={stayId} justCheckedIn={checkedIn === "1"} />
    </PermissionGate>
  );
}
