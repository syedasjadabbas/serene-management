import type { Metadata } from "next";
import { NightAuditRunView } from "./components/NightAuditRunView";

export const metadata: Metadata = { title: "Night audit run" };

export default async function NightAuditRunPage({
  params,
}: {
  params: Promise<{ propertyCode: string; runId: string }>;
}) {
  const { runId } = await params;
  return <NightAuditRunView runId={runId} />;
}
