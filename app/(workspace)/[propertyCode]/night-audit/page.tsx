import type { Metadata } from "next";
import { NightAuditWorkspace } from "./components/NightAuditWorkspace";

export const metadata: Metadata = { title: "Night audit" };

export default function NightAuditPage() {
  return <NightAuditWorkspace />;
}
