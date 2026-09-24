"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import type { Permission } from "@/lib/permissions/catalog";

const ITEMS: { segment: string; label: string; permission: Permission | null }[] = [
  { segment: "", label: "Overview", permission: null },
  { segment: "front-desk", label: "Front desk", permission: "frontdesk:read" },
  { segment: "availability", label: "Availability", permission: "availability:read" },
  { segment: "reservations", label: "Reservations", permission: "reservations:read" },
];

/** Primary workspace navigation; items the user cannot use are not shown (the server still enforces). */
export function WorkspaceNav() {
  const property = useProperty();
  const pathname = usePathname();
  const { can } = usePermissions(property.id);
  const base = `/${property.code}`;

  return (
    <nav
      aria-label="Workspace"
      className="order-last -mx-1 w-full overflow-x-auto md:order-none md:mx-0 md:w-auto"
    >
      <ul className="flex items-center gap-0.5">
        {ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => {
          const href = item.segment ? `${base}/${item.segment}` : base;
          const active = item.segment ? pathname.startsWith(href) : pathname === base;
          return (
            <li key={item.label}>
              <Link
                href={href as Route}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
                  active
                    ? "bg-brand-subtle font-medium text-brand"
                    : "text-fg-secondary hover:bg-surface-sunken hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
