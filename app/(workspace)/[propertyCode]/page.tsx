import type { Metadata } from "next";
import { PropertyOverview } from "./components/PropertyOverview";

export const metadata: Metadata = { title: "Workspace" };

/**
 * Property landing page: the property context and business date, and (with
 * dashboard access) today's figures, the last closed date and the trend.
 */
export default function PropertyHomePage() {
  return <PropertyOverview />;
}
