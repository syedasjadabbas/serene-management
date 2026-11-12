import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { NightAuditRunView } from "./_components/NightAuditRunView";

export const metadata: Metadata = { title: "Night audit run" };

export default async function NightAuditRunPage({
  params,
}: {
  params: Promise<{ propertyCode: string; runId: string }>;
}) {
  const { runId } = await params;
  return (
    <PermissionGate permission={P.NIGHTAUDIT_READ}>
      <NightAuditRunView runId={runId} />
    </PermissionGate>
  );
}
