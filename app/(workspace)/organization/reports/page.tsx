import type { Metadata } from "next";
import { PerformanceReport } from "./components/PerformanceReport";

export const metadata: Metadata = { title: "Organization reports" };

export default function OrganizationReportsPage() {
  return <PerformanceReport />;
}
