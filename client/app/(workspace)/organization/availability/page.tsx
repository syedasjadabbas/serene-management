import type { Metadata } from "next";
import { OrganizationSectionGuard } from "../_components/OrganizationSectionGuard";
import { CentralAvailability } from "./_components/CentralAvailability";

export const metadata: Metadata = { title: "Central availability" };

export default function CentralAvailabilityPage() {
  return (
    <OrganizationSectionGuard segment="availability">
      <CentralAvailability />
    </OrganizationSectionGuard>
  );
}
