import type { Metadata } from "next";
import { PropertyOverview } from "./components/PropertyOverview";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Property dashboard: business date, today's figures, arrivals, room status,
 * operations and the last closed date — each part gated by its permission.
 */
export default function PropertyHomePage() {
  return <PropertyOverview />;
}
