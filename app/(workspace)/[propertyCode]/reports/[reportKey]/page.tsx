import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { ReportView } from "./components/ReportView";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({
  params,
}: {
  params: Promise<{ propertyCode: string; reportKey: string }>;
}) {
  const { reportKey } = await params;
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading the report" />}>
      <ReportView reportKey={reportKey} />
    </Suspense>
  );
}
