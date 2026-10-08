import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { canUseOrganizationWorkspace } from "@/components/workspace/sections";
import { getServerMe } from "@/lib/auth/session";
import { OrganizationShell } from "./components/OrganizationShell";

/**
 * Organization workspace (Phase 9): cross-property views, offered when at
 * least one of its sections is permitted (each page guards its own section).
 * Everything shown is limited by the server to the properties and scopes the
 * user may use.
 */
export default async function OrganizationLayout({ children }: { children: ReactNode }) {
  const me = await getServerMe();
  if (!me) redirect("/login");
  if (!canUseOrganizationWorkspace(me)) {
    return (
      <StatusPanel
        level={1}
        kind="forbidden"
        title="Access denied"
        description="Your roles do not include any organization section (reports, availability, audit trail, users and roles, properties)."
        action={
          <Link
            href="/"
            className="text-sm font-medium text-brand underline-offset-2 hover:underline"
          >
            Go to your property
          </Link>
        }
      />
    );
  }
  return <OrganizationShell>{children}</OrganizationShell>;
}
