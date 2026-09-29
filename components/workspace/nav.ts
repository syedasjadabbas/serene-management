import type { LucideIcon } from "lucide-react";

/**
 * Navigation model shared by the top navigation bar (PrimaryNav, lg and up)
 * and the mobile navigation panel (MobileNav). Workspaces build a list of
 * entries from their section tables (components/workspace/sections.ts),
 * already filtered by the user's permissions; the components only render.
 */
export interface NavLinkItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The current page belongs to this item (route, nested route or tab). */
  active: boolean;
  /** One short line under the label inside a menu. */
  description?: string;
}

export type NavEntry =
  | ({ kind: "link" } & NavLinkItem)
  | {
      kind: "group";
      /** Stable id for aria wiring ("front-office"). */
      id: string;
      label: string;
      icon: LucideIcon;
      /** Optional heading shown at the top of the menu ("Organization"). */
      heading?: string;
      items: NavLinkItem[];
    };

/** True when the entry, or one of its items, is the current page. */
export function entryActive(entry: NavEntry): boolean {
  return entry.kind === "link" ? entry.active : entry.items.some((item) => item.active);
}

/** Drops groups that ended up with no visible items after permission filtering. */
export function withoutEmptyGroups(entries: NavEntry[]): NavEntry[] {
  return entries.filter((entry) => entry.kind === "link" || entry.items.length > 0);
}
