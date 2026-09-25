import type { Metadata } from "next";
import { ReportsCatalog } from "./components/ReportsCatalog";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsCatalog />;
}
