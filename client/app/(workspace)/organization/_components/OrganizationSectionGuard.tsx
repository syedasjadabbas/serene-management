"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import {
  ORGANIZATION_SECTIONS,
  organizationHomeHref,
} from "@/global/components/workspace/sections";
import { useMeQuery } from "@/global/api/endpoints/sessionApi";

/**
 * Renders an organization section only for users who may open it (the same
 * rule that lists it under "More"). The workspace is offered per section, so
 * a user can reach it for one section (Users & roles) without the others;
 * the section's API still decides what data they get. Evaluated on the
 * client from `/me`.
 */
export function OrganizationSectionGuard({
  segment,
  children,
}: {
  segment: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { data: me } = useMeQuery();
  const section = ORGANIZATION_SECTIONS.find((s) => s.segment === segment);
  const allowed = me !== undefined && section?.visible(me) === true;
  // "/organization" (breadcrumbs, links) for a user without the overview
  // opens the first section they do have.
  const redirectTo =
    me && !allowed && segment === "" && organizationHomeHref(me) !== "/organization"
      ? organizationHomeHref(me)
      : null;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo as Route);
  }, [redirectTo, router]);

  if (!me || redirectTo) return <StatusPanel level={1} kind="loading" title="Loading" />;
  if (allowed) return <>{children}</>;
  return (
    <StatusPanel
      level={1}
      kind="forbidden"
      title="Access denied"
      description={`Your roles do not include ${section?.label ?? "this section"}.`}
      action={
        <Link
          href={organizationHomeHref(me) as Route}
          className="text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          Go to the organization workspace
        </Link>
      }
    />
  );
}
