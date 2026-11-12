import type { Metadata } from "next";
import { ReportsCatalog } from "./_components/ReportsCatalog";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsCatalog />;
}
