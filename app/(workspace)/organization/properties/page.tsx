import type { Metadata } from "next";
import { PropertiesPanel } from "./components/PropertiesPanel";

export const metadata: Metadata = { title: "Properties" };

export default function OrganizationPropertiesPage() {
  return <PropertiesPanel />;
}
