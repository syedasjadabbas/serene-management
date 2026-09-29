"use client";

import {
  BedDouble,
  CalendarCheck,
  CalendarRange,
  ChartColumn,
  ConciergeBell,
  Contact,
  LayoutDashboard,
  type LucideIcon,
  MoonStar,
  Receipt,
  Tags,
  UsersRound,
  Wrench,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { SideNav } from "@/components/workspace/SideNav";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { PROPERTY_SECTIONS } from "@/components/workspace/sections";

const ICONS: Record<string, LucideIcon> = {
  "": LayoutDashboard,
  "front-desk": ConciergeBell,
  billing: Receipt,
  housekeeping: BedDouble,
  maintenance: Wrench,
  availability: CalendarRange,
  reservations: CalendarCheck,
  guests: Contact,
  groups: UsersRound,
  rates: Tags,
  "night-audit": MoonStar,
  reports: ChartColumn,
};

/** Primary workspace navigation; items the user cannot use are not shown (the server still enforces). */
export function WorkspaceNav() {
  const property = useProperty();
  const pathname = usePathname();
  const { can } = usePermissions(property.id);
  const base = `/${property.code}`;

  const items = PROPERTY_SECTIONS.filter((item) => !item.permission || can(item.permission)).map(
    (item) => {
      const href = item.segment ? `${base}/${item.segment}` : base;
      return {
        href,
        label: item.label,
        group: item.group,
        icon: ICONS[item.segment] ?? LayoutDashboard,
        active: item.segment ? pathname.startsWith(href) : pathname === base,
      };
    },
  );
  return <SideNav label="Workspace" items={items} />;
}
