import type { Metadata } from "next";
import { OrganizationAuditTrail } from "./components/OrganizationAuditTrail";

export const metadata: Metadata = { title: "Audit trail" };

export default function OrganizationAuditPage() {
  return <OrganizationAuditTrail />;
}
