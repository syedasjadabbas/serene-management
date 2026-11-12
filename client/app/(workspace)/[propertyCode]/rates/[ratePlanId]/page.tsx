import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { RatePlanDetailView } from "./_components/RatePlanDetailView";

export const metadata: Metadata = { title: "Rate plan" };

export default async function RatePlanPage({
  params,
}: {
  params: Promise<{ propertyCode: string; ratePlanId: string }>;
}) {
  const { ratePlanId } = await params;
  return (
    <PermissionGate permission={P.RATES_READ}>
      <RatePlanDetailView ratePlanId={ratePlanId} />
    </PermissionGate>
  );
}
