import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { ORGANIZATION_SECTIONS, organizationHomeHref } from "@/components/workspace/sections";
import { getServerMe } from "@/lib/auth/session";

/**
 * Renders an organization section only for users who may open it (the same
 * rule that lists it under "More"). The workspace is offered per section, so
 * a user can reach it for one section (Users & roles) without the others;
 * the section's API still decides what data they get.
 */
export async function OrganizationSectionGuard({
  segment,
  children,
}: {
  segment: string;
  children: ReactNode;
}) {
  const me = await getServerMe();
  if (!me) redirect("/login");
  const section = ORGANIZATION_SECTIONS.find((s) => s.segment === segment);
  if (section?.visible(me)) return <>{children}</>;
  // "/organization" (breadcrumbs, links) for a user without the overview
  // opens the first section they do have.
  if (segment === "" && organizationHomeHref(me) !== "/organization") {
    redirect(organizationHomeHref(me) as Route);
  }
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
