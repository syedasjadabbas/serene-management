import type { Metadata } from "next";
import { PropertyOverview } from "./components/PropertyOverview";

export const metadata: Metadata = { title: "Workspace" };

/**
 * Phase 1 property landing page: confirms the property context, business
 * date and the user's access. PMS modules arrive in later phases.
 */
export default function PropertyHomePage() {
  return <PropertyOverview />;
}
