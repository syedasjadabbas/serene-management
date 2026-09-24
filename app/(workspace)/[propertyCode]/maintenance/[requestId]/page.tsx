import type { Metadata } from "next";
import { RequestDetailView } from "./components/RequestDetailView";

export const metadata: Metadata = { title: "Maintenance request" };

export default async function MaintenanceRequestPage({
  params,
}: {
  params: Promise<{ propertyCode: string; requestId: string }>;
}) {
  const { requestId } = await params;
  return <RequestDetailView requestId={requestId} />;
}
