import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../components/OrganizationSectionGuard";
import { PropertiesPanel } from "./components/PropertiesPanel";

export const metadata: Metadata = { title: "Properties" };

export default function OrganizationPropertiesPage() {
  return (
    <OrganizationSectionGuard segment="properties">
      <PropertiesPanel />
    </OrganizationSectionGuard>
  );
}
