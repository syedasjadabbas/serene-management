"use client";

import {
  Building2,
  CalendarRange,
  ChartColumn,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  UsersRound,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { SideNav } from "@/components/workspace/SideNav";
import { ORGANIZATION_SECTIONS } from "@/components/workspace/sections";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

const ICONS: Record<string, LucideIcon> = {
  "": LayoutDashboard,
  reports: ChartColumn,
  availability: CalendarRange,
  audit: ScrollText,
  users: UsersRound,
  properties: Building2,
};

/** Organization navigation; sections the user cannot use are hidden (the server still enforces). */
export function OrganizationNav() {
  const pathname = usePathname();
  const { data: me } = useMeQuery();
  const base = "/organization";
  const items = ORGANIZATION_SECTIONS.filter((s) => (me ? s.visible(me) : s.segment === "")).map(
    (section) => {
      const href = section.segment ? `${base}/${section.segment}` : base;
      return {
        href,
        label: section.label,
        icon: ICONS[section.segment] ?? LayoutDashboard,
        active: section.segment ? pathname.startsWith(href) : pathname === base,
      };
    },
  );
  return <SideNav label="Organization" items={items} />;
}
