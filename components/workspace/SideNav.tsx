"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useId } from "react";
import { cn } from "@/components/ui/cn";
import { useRailCollapsed } from "./rail";

export interface SideNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Optional group heading; consecutive items with the same group are listed together. */
  group?: string;
}

/**
 * Vertical navigation on the light rail (and in the mobile drawer). Items are
 * grouped under quiet sentence-case headings; the current page is a solid
 * brand pill (aria-current="page"). Targets are 40px, 44px on touch screens.
 * In the collapsed rail only icons show: labels stay for screen readers and
 * as tooltips, and group headings become hairline dividers.
 */
export function SideNav({ label, items }: { label: string; items: SideNavItem[] }) {
  const idPrefix = useId();
  const collapsed = useRailCollapsed();
  const groups: { name: string | undefined; items: SideNavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return (
    <nav aria-label={label} className={cn("flex flex-col", collapsed ? "gap-3" : "gap-5")}>
      {groups.map((group, index) => {
        const headingId = group.name ? `${idPrefix}-group-${index}` : undefined;
        return (
          <div key={group.name ?? index} className="flex flex-col gap-1">
            {group.name ? (
              <p
                id={headingId}
                className={cn(
                  collapsed ? "sr-only" : "px-3 pb-1 text-xs font-medium text-nav-fg-muted",
                )}
              >
                {group.name}
              </p>
            ) : null}
            {collapsed && index > 0 ? (
              <div aria-hidden="true" className="mx-2 mb-2 border-t border-nav-border" />
            ) : null}
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href as Route}
                    aria-current={item.active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group flex h-10 items-center gap-3 rounded-md text-sm transition-colors duration-150 pointer-coarse:h-11",
                      collapsed ? "justify-center" : "px-3",
                      item.active
                        ? "bg-nav-active font-medium text-nav-fg-active shadow-raised"
                        : "text-nav-fg hover:bg-nav-raised hover:text-nav-fg-hover",
                    )}
                  >
                    <item.icon
                      aria-hidden="true"
                      className={cn(
                        "size-[1.125rem] shrink-0",
                        item.active
                          ? "text-nav-fg-active"
                          : "text-nav-fg-muted group-hover:text-nav-fg-hover",
                      )}
                    />
                    <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
