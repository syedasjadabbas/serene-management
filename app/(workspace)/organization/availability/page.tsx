import type { Metadata } from "next";
import { CentralAvailability } from "./components/CentralAvailability";

export const metadata: Metadata = { title: "Central availability" };

export default function CentralAvailabilityPage() {
  return <CentralAvailability />;
}
