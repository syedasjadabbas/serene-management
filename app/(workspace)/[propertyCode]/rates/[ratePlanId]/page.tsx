import type { Metadata } from "next";
import { RatePlanDetailView } from "./components/RatePlanDetailView";

export const metadata: Metadata = { title: "Rate plan" };

export default async function RatePlanPage({
  params,
}: {
  params: Promise<{ propertyCode: string; ratePlanId: string }>;
}) {
  const { ratePlanId } = await params;
  return <RatePlanDetailView ratePlanId={ratePlanId} />;
}
