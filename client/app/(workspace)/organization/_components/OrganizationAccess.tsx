"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { canUseOrganizationWorkspace } from "@/global/components/workspace/sections";
import { useMeQuery } from "@/global/api/endpoints/sessionApi";
import { OrganizationShell } from "./OrganizationShell";

/** Client-side check (from `/me`) that the user may open any organization section. */
export function OrganizationAccess({ children }: { children: ReactNode }) {
  const { data: me } = useMeQuery();
  if (!me) {
    return (
      <main id="main">
        <StatusPanel level={1} kind="loading" title="Loading organization" />
      </main>
    );
  }
  if (!canUseOrganizationWorkspace(me)) {
    return (
      <main id="main">
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
      </main>
    );
  }
  return <OrganizationShell>{children}</OrganizationShell>;
}
