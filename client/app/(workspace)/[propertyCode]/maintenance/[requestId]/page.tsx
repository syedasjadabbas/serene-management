import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { RequestDetailView } from "./_components/RequestDetailView";

export const metadata: Metadata = { title: "Maintenance request" };

export default async function MaintenanceRequestPage({
  params,
}: {
  params: Promise<{ propertyCode: string; requestId: string }>;
}) {
  const { requestId } = await params;
  return (
    <PermissionGate permission={P.MAINTENANCE_READ}>
      <RequestDetailView requestId={requestId} />
    </PermissionGate>
  );
}
