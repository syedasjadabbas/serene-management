import type { ReactNode } from "react";
import { OrganizationAccess } from "./_components/OrganizationAccess";

/**
 * Organization workspace (Phase 9): cross-property views, offered when at
 * least one of its sections is permitted (each page guards its own section).
 * Everything shown is limited by the server to the properties and scopes the
 * user may use.
 */
export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return <OrganizationAccess>{children}</OrganizationAccess>;
}
