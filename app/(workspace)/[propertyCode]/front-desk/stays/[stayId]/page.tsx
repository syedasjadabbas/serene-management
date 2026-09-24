import type { Metadata } from "next";
import { StayDetailView } from "./components/StayDetailView";

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
  return <StayDetailView stayId={stayId} justCheckedIn={checkedIn === "1"} />;
}
