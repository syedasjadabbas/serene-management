"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { ORGANIZATION_SECTIONS } from "@/components/workspace/sections";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

/** Organization navigation; sections the user cannot use are hidden (the server still enforces). */
export function OrganizationNav() {
  const pathname = usePathname();
  const { data: me } = useMeQuery();
  const base = "/organization";
  return (
    <nav
      aria-label="Organization"
      className="order-last -mx-1 w-full overflow-x-auto lg:order-none lg:mx-0 lg:w-auto lg:min-w-0"
    >
      <ul className="flex items-center gap-0.5">
        {ORGANIZATION_SECTIONS.filter((s) => (me ? s.visible(me) : s.segment === "")).map(
          (section) => {
            const href = section.segment ? `${base}/${section.segment}` : base;
            const active = section.segment ? pathname.startsWith(href) : pathname === base;
            return (
              <li key={section.label}>
                <Link
                  href={href as Route}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap lg:px-2 xl:px-2.5",
                    active
                      ? "bg-brand-subtle font-medium text-brand"
                      : "text-fg-secondary hover:bg-surface-sunken hover:text-fg",
                  )}
                >
                  {section.label}
                </Link>
              </li>
            );
          },
        )}
      </ul>
    </nav>
  );
}
