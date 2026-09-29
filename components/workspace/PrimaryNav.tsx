"use client";

import Link from "next/link";
import type { Route } from "next";
import { type NavEntry } from "./nav";
import { NavMenu, navItemClass } from "./NavMenu";

/**
 * The workspace's primary navigation bar (lg and up), under the global
 * header: direct links for the daily destinations and a small menu per
 * domain. The current page's item (or the domain holding it) is a mint pill
 * in brand green. Menus in the second half of the bar open towards the end
 * so they never run off the screen.
 */
export function PrimaryNav({ label, entries }: { label: string; entries: NavEntry[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-1">
        {entries.map((entry, index) => (
          <li key={entry.kind === "link" ? entry.href : entry.id}>
            {entry.kind === "link" ? (
              <Link
                href={entry.href as Route}
                aria-current={entry.active ? "page" : undefined}
                className={navItemClass(entry.active)}
              >
                {entry.label}
              </Link>
            ) : (
              <NavMenu
                label={entry.label}
                heading={entry.heading}
                items={entry.items}
                align={index >= entries.length / 2 ? "end" : "start"}
              />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
