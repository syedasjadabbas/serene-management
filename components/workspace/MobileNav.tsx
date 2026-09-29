"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useId, useState } from "react";
import { cn } from "@/components/ui/cn";
import { type NavEntry, type NavLinkItem, entryActive } from "./nav";

function itemClass(active: boolean, nested = false) {
  return cn(
    "flex min-h-11 items-center gap-3 rounded-md px-3 text-base transition-colors duration-150",
    nested && "ps-11",
    active
      ? "bg-brand-subtle font-semibold text-brand"
      : "font-medium text-fg hover:bg-surface-sunken",
  );
}

function NavLinkRow({ item, nested = false }: { item: NavLinkItem; nested?: boolean }) {
  return (
    <Link
      href={item.href as Route}
      aria-current={item.active ? "page" : undefined}
      className={itemClass(item.active, nested)}
    >
      {nested ? null : (
        <item.icon
          aria-hidden="true"
          className={cn("size-[1.125rem] shrink-0", item.active ? "text-brand" : "text-fg-muted")}
        />
      )}
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}

/**
 * The navigation panel of the mobile/tablet drawer (below lg): direct links
 * and expandable domains in the same order and grouping as the top bar.
 * Each domain is a disclosure (aria-expanded/aria-controls); the one holding
 * the current page starts open. Rows are 44px touch targets. The drawer
 * itself traps focus, closes on Escape and returns focus to the menu button.
 */
export function MobileNav({ label, entries }: { label: string; entries: NavEntry[] }) {
  const prefix = useId();
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        entries
          .filter((e) => e.kind === "group" && entryActive(e))
          .map((e) => (e.kind === "group" ? e.id : "")),
      ),
  );

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) => {
          if (entry.kind === "link") {
            return (
              <li key={entry.href}>
                <NavLinkRow item={entry} />
              </li>
            );
          }
          const open = expanded.has(entry.id);
          const panelId = `${prefix}-${entry.id}`;
          const active = entryActive(entry);
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(entry.id)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-start text-base transition-colors duration-150 hover:bg-surface-sunken",
                  active ? "font-semibold text-brand" : "font-medium text-fg",
                )}
              >
                <entry.icon
                  aria-hidden="true"
                  className={cn(
                    "size-[1.125rem] shrink-0",
                    active ? "text-brand" : "text-fg-muted",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-fg-muted transition-transform duration-150 motion-reduce:transition-none",
                    open && "rotate-180",
                  )}
                />
              </button>
              <ul id={panelId} hidden={!open} className="mt-0.5 mb-1 flex flex-col gap-0.5">
                {entry.heading ? (
                  <li aria-hidden="true" className="ps-11 pt-1 pb-1 label-caps">
                    {entry.heading}
                  </li>
                ) : null}
                {entry.items.map((item) => (
                  <li key={item.href}>
                    <NavLinkRow item={item} nested />
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
