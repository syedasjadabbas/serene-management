import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../_components/OrganizationSectionGuard";
import { PerformanceReport } from "./_components/PerformanceReport";

export const metadata: Metadata = { title: "Organization reports" };

export default function OrganizationReportsPage() {
  return (
    <OrganizationSectionGuard segment="reports">
      <PerformanceReport />
    </OrganizationSectionGuard>
  );
}
