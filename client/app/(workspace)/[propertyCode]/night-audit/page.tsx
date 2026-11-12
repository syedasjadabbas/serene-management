import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { NightAuditWorkspace } from "./_components/NightAuditWorkspace";

export const metadata: Metadata = { title: "Night audit" };

export default function NightAuditPage() {
  return (
    <PermissionGate permission={P.NIGHTAUDIT_READ}>
      <NightAuditWorkspace />
    </PermissionGate>
  );
}
