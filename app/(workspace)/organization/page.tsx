import type { Metadata } from "next";
import { OrganizationSectionGuard } from "./components/OrganizationSectionGuard";
import { OrganizationOverviewPanel } from "./components/OrganizationOverviewPanel";

export const metadata: Metadata = { title: "Organization" };

/** Organization landing page: one card per accessible property. */
export default function OrganizationHomePage() {
  return (
    <OrganizationSectionGuard segment="">
      <OrganizationOverviewPanel />
    </OrganizationSectionGuard>
  );
}
