"use client";

import {
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarRange,
  ChartColumn,
  ConciergeBell,
  Contact,
  Ellipsis,
  Gift,
  Hotel,
  LayoutDashboard,
  type LucideIcon,
  MoonStar,
  Receipt,
  ScrollText,
  Sparkles,
  Tags,
  UsersRound,
  Wrench,
  BriefcaseBusiness,
  BedSingle,
  Landmark,
  SlidersHorizontal,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { MobileNav } from "@/components/workspace/MobileNav";
import { PrimaryNav } from "@/components/workspace/PrimaryNav";
import { type NavEntry, type NavLinkItem, withoutEmptyGroups } from "@/components/workspace/nav";
import {
  PROPERTY_NAV,
  type PropertyNavItem,
  type PropertyNavNode,
  organizationSections,
  propertyNavItemActive,
  propertySection,
  visiblePropertyNav,
} from "@/components/workspace/sections";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

/** Icons by navigation key (segment, or segment:tab). */
const ICONS: Record<string, LucideIcon> = {
  "": LayoutDashboard,
  "front-desk": ConciergeBell,
  reservations: CalendarCheck,
  availability: CalendarRange,
  "guests:guests": Contact,
  "guests:companies": BriefcaseBusiness,
  groups: UsersRound,
  "guests:loyalty": Sparkles,
  housekeeping: BedDouble,
  maintenance: Wrench,
  setup: SlidersHorizontal,
  "rates:plans": Tags,
  "rates:packages": Gift,
  billing: Receipt,
  "night-audit": MoonStar,
  reports: ChartColumn,
};
const GROUP_ICONS: Record<string, LucideIcon> = {
  "front-office": ConciergeBell,
  guests: Contact,
  rooms: BedSingle,
  revenue: Landmark,
};
const ORGANIZATION_ICONS: Record<string, LucideIcon> = {
  "": Building2,
  reports: ChartColumn,
  availability: CalendarRange,
  audit: ScrollText,
  users: UsersRound,
  properties: Hotel,
};

/**
 * The property workspace navigation, rendered as the top bar (`variant="bar"`,
 * lg and up) or the mobile panel (`variant="panel"`). Items the user cannot
 * use are not shown and empty groups disappear; the server still enforces
 * every route. "More" lists the organization sections the user may open.
 */
export function WorkspaceNav({ variant }: { variant: "bar" | "panel" }) {
  const property = useProperty();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const { data: me } = useMeQuery();
  const { can } = usePermissions(property.id);
  const base = `/${property.code}`;

  const toLink = (item: PropertyNavItem, siblings: PropertyNavItem[]): NavLinkItem => {
    const path = item.segment ? `${base}/${item.segment}` : base;
    const key = item.tab ? `${item.segment}:${item.tab}` : item.segment;
    return {
      href: item.tab && !item.defaultTab ? `${path}?tab=${item.tab}` : path,
      label: item.label ?? propertySection(item.segment).label,
      icon: ICONS[key] ?? LayoutDashboard,
      description: item.description,
      active: propertyNavItemActive(item, siblings, base, pathname, tab),
    };
  };

  // Sibling lists for "current tab" come from the full definition, so a
  // hidden tab never changes which visible tab is current.
  const full = (id: string) =>
    PROPERTY_NAV.find((n) => n.kind === "group" && n.id === id) as
      Extract<PropertyNavNode, { kind: "group" }> | undefined;
  const entries: NavEntry[] = visiblePropertyNav(can).map((node): NavEntry => {
    if (node.kind === "link") return { kind: "link", ...toLink(node, [node]) };
    return {
      kind: "group",
      id: node.id,
      label: node.label,
      icon: GROUP_ICONS[node.id] ?? LayoutDashboard,
      items: node.items.map((item) => toLink(item, full(node.id)?.items ?? node.items)),
    };
  });

  // "More" holds the organization sections this user may open; it is shown
  // whenever there is at least one (withoutEmptyGroups drops it otherwise).
  if (me) {
    entries.push({
      kind: "group",
      id: "more",
      label: "More",
      icon: Ellipsis,
      heading: "Organization",
      items: organizationSections(me).map((s) => ({
        href: s.segment ? `/organization/${s.segment}` : "/organization",
        label: s.segment ? s.label : "Organization overview",
        icon: ORGANIZATION_ICONS[s.segment] ?? Building2,
        active: false,
      })),
    });
  }

  const visible = withoutEmptyGroups(entries);
  return variant === "bar" ? (
    <PrimaryNav label="Property" entries={visible} />
  ) : (
    <MobileNav label="Property" entries={visible} />
  );
}
