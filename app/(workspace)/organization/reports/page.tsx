import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../components/OrganizationSectionGuard";
import { PerformanceReport } from "./components/PerformanceReport";

export const metadata: Metadata = { title: "Organization reports" };

export default function OrganizationReportsPage() {
  return (
    <OrganizationSectionGuard segment="reports">
      <PerformanceReport />
    </OrganizationSectionGuard>
  );
}
