import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../_components/OrganizationSectionGuard";
import { OrganizationAuditTrail } from "./_components/OrganizationAuditTrail";

export const metadata: Metadata = { title: "Audit trail" };

export default function OrganizationAuditPage() {
  return (
    <OrganizationSectionGuard segment="audit">
      <OrganizationAuditTrail />
    </OrganizationSectionGuard>
  );
}
