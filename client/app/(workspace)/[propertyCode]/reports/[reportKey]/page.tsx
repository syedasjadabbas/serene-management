import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { ReportView } from "./_components/ReportView";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({
  params,
}: {
  params: Promise<{ propertyCode: string; reportKey: string }>;
}) {
  const { reportKey } = await params;
  return (
    <Suspense fallback={<PageSkeleton title="Loading the report" />}>
      <ReportView reportKey={reportKey} />
    </Suspense>
  );
}
