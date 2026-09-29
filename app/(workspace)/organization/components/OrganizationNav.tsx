"use client";

import {
  CalendarRange,
  ChartColumn,
  Hotel,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  UsersRound,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/workspace/MobileNav";
import { PrimaryNav } from "@/components/workspace/PrimaryNav";
import type { NavEntry } from "@/components/workspace/nav";
import { ORGANIZATION_SECTIONS } from "@/components/workspace/sections";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

const ICONS: Record<string, LucideIcon> = {
  "": LayoutDashboard,
  reports: ChartColumn,
  availability: CalendarRange,
  audit: ScrollText,
  users: UsersRound,
  properties: Hotel,
};

/**
 * Organization navigation, as the top bar (`variant="bar"`) or the drawer
 * panel (`variant="panel"`). Six sections fit the bar as direct links;
 * sections the user cannot use are hidden (the server still enforces).
 */
export function OrganizationNav({ variant }: { variant: "bar" | "panel" }) {
  const pathname = usePathname();
  const { data: me } = useMeQuery();
  const base = "/organization";
  const entries: NavEntry[] = ORGANIZATION_SECTIONS.filter((s) =>
    me ? s.visible(me) : s.segment === "",
  ).map((section) => {
    const href = section.segment ? `${base}/${section.segment}` : base;
    return {
      kind: "link",
      href,
      label: section.label,
      icon: ICONS[section.segment] ?? LayoutDashboard,
      active: section.segment ? pathname.startsWith(href) : pathname === base,
    };
  });
  return variant === "bar" ? (
    <PrimaryNav label="Organization" entries={entries} />
  ) : (
    <MobileNav label="Organization" entries={entries} />
  );
}
