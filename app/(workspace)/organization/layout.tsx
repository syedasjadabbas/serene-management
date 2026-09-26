import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { canUseOrganizationWorkspace } from "@/components/workspace/sections";
import { getServerMe } from "@/lib/auth/session";
import { OrganizationShell } from "./components/OrganizationShell";

/**
 * Organization workspace (Phase 9): cross-property views for users with
 * organization grants or several properties. Everything shown is limited by
 * the server to the properties and scopes the user may use.
 */
export default async function OrganizationLayout({ children }: { children: ReactNode }) {
  const me = await getServerMe();
  if (!me) redirect("/login");
  if (!canUseOrganizationWorkspace(me)) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="The organization workspace is for users who work across properties."
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
