import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../components/OrganizationSectionGuard";
import { OrganizationAuditTrail } from "./components/OrganizationAuditTrail";

export const metadata: Metadata = { title: "Audit trail" };

export default function OrganizationAuditPage() {
  return (
    <OrganizationSectionGuard segment="audit">
      <OrganizationAuditTrail />
    </OrganizationSectionGuard>
  );
}
