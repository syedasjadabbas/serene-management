import type { Metadata } from "next";
import { NightAuditWorkspace } from "./_components/NightAuditWorkspace";

export const metadata: Metadata = { title: "Night audit" };

export default function NightAuditPage() {
  return <NightAuditWorkspace />;
}
