import type { MeView } from "@/modules/access/access.types";
import type { Permission } from "@/lib/permissions/catalog";

/**
 * Sections of the property workspace, in navigation order, grouped in the
 * top navigation by the kind of work (front office, rooms, revenue and
 * finance). Grouping is presentation only; `permission` gates visibility.
 */
export const PROPERTY_SECTIONS: {
  segment: string;
  label: string;
  group: "Front office" | "Rooms" | "Revenue & finance";
  permission: Permission | null;
}[] = [
  { segment: "", label: "Dashboard", group: "Front office", permission: null },
  {
    segment: "front-desk",
    label: "Front desk",
    group: "Front office",
    permission: "frontdesk:read",
  },
  {
    segment: "reservations",
    label: "Reservations",
    group: "Front office",
    permission: "reservations:read",
  },
  {
    segment: "availability",
    label: "Availability",
    group: "Front office",
    permission: "availability:read",
  },
  { segment: "guests", label: "Guests", group: "Front office", permission: "guests:read" },
  { segment: "groups", label: "Groups", group: "Front office", permission: "groups:read" },
  {
    segment: "housekeeping",
    label: "Housekeeping",
    group: "Rooms",
    permission: "housekeeping:read",
  },
  { segment: "maintenance", label: "Maintenance", group: "Rooms", permission: "maintenance:read" },
  { segment: "setup", label: "Property setup", group: "Rooms", permission: "settings:read" },
  { segment: "rates", label: "Rates", group: "Revenue & finance", permission: "rates:read" },
  { segment: "billing", label: "Billing", group: "Revenue & finance", permission: "billing:read" },
  {
    segment: "night-audit",
    label: "Night audit",
    group: "Revenue & finance",
    permission: "nightaudit:read",
  },
  { segment: "reports", label: "Reports", group: "Revenue & finance", permission: "reports:read" },
];

/** One destination in the property's top navigation. */
export interface PropertyNavItem {
  /** Route segment; label and permission default to its PROPERTY_SECTIONS row. */
  segment: string;
  label?: string;
  /** Overrides the section's permission (tabs gated by their own permission). */
  permission?: Permission | null;
  /** Opens this tab of the section page (`?tab=`). */
  tab?: string;
  /** The section's default tab: also current on record pages and unknown tabs. */
  defaultTab?: boolean;
  /** Other route segments that belong to this item (company records → Companies). */
  alsoActive?: string[];
  description?: string;
}

export type PropertyNavNode =
  | ({ kind: "link" } & PropertyNavItem)
  | { kind: "group"; id: string; label: string; items: PropertyNavItem[] };

/**
 * The property workspace's top navigation: a few domains instead of a flat
 * list, in the order of daily work. Labels are the section and tab labels
 * the pages already use; visibility follows the same permissions as the
 * pages (UI gating only, the server enforces). Companies and Loyalty are
 * tabs of Guests, Packages a tab of Rates.
 */
export const PROPERTY_NAV: PropertyNavNode[] = [
  { kind: "link", segment: "" },
  {
    kind: "group",
    id: "front-office",
    label: "Front office",
    items: [
      { segment: "front-desk", description: "Arrivals, in-house guests and departures" },
      { segment: "reservations", description: "Find, create and change bookings" },
      { segment: "availability", description: "Rooms and rates for any stay" },
    ],
  },
  {
    kind: "group",
    id: "guests",
    label: "Guests",
    items: [
      {
        segment: "guests",
        tab: "guests",
        defaultTab: true,
        description: "Guest profiles, preferences and stays",
      },
      {
        segment: "guests",
        tab: "companies",
        label: "Companies",
        permission: "accounts:read",
        alsoActive: ["companies"],
        description: "Corporate and agency accounts",
      },
      { segment: "groups", description: "Room blocks and pickup" },
      {
        segment: "guests",
        tab: "loyalty",
        label: "Loyalty",
        permission: "loyalty:read",
        description: "Members, tiers and points",
      },
    ],
  },
  {
    kind: "group",
    id: "rooms",
    label: "Rooms",
    items: [
      { segment: "housekeeping", description: "Room board, cleaning and inspections" },
      { segment: "maintenance", description: "Work orders and rooms out of use" },
      { segment: "setup", description: "Room types, rooms, taxes, settings and go-live" },
    ],
  },
  {
    kind: "group",
    id: "revenue",
    label: "Revenue & finance",
    items: [
      {
        segment: "rates",
        defaultTab: true,
        tab: "plans",
        description: "Rate plans, pricing calendar and restrictions",
      },
      {
        segment: "rates",
        tab: "packages",
        label: "Packages",
        description: "Extras sold with a rate",
      },
      { segment: "billing", description: "Folios, charges and payments" },
    ],
  },
  { kind: "link", segment: "night-audit" },
  { kind: "link", segment: "reports" },
];

/** The PROPERTY_SECTIONS row of a segment (label, default permission). */
export function propertySection(segment: string) {
  const section = PROPERTY_SECTIONS.find((s) => s.segment === segment);
  if (!section) throw new Error(`Unknown property section "${segment}"`);
  return section;
}

/**
 * Whether a navigation item is the current page: its route (and any nested
 * record route), and for tab items the matching `?tab=`. The default tab
 * also covers record pages and tabs that no sibling item claims.
 */
export function propertyNavItemActive(
  item: PropertyNavItem,
  siblings: PropertyNavItem[],
  base: string,
  pathname: string,
  tab: string | null,
): boolean {
  const under = (segment: string) =>
    segment === "" ? pathname === base : pathname.startsWith(`${base}/${segment}`);
  if (item.alsoActive?.some(under)) return true;
  if (!under(item.segment)) return false;
  if (!item.tab) return true;
  if (tab === item.tab) return true;
  if (!item.defaultTab) return false;
  const claimed = siblings.some((s) => s.segment === item.segment && s.tab === tab && s !== item);
  return tab === null || !claimed;
}

type MeProperty = MeView["properties"][number];

function holds(me: MeView, property: MeProperty, permission: Permission | null) {
  return permission === null || me.user.isSuperAdmin || property.permissions.includes(permission);
}

/**
 * Where switching to `target` leads (Phase 9): the same section when the
 * user may use it there, otherwise the target's overview. Only the section
 * is kept — record ids (a reservation, a folio) belong to one property.
 */
export function switchHref(me: MeView, target: MeProperty, pathname: string): string {
  const segment = pathname.split("/")[2] ?? "";
  const section = PROPERTY_SECTIONS.find((s) => s.segment === segment && s.segment !== "");
  return section && holds(me, target, section.permission)
    ? `/${target.code}/${section.segment}`
    : `/${target.code}`;
}

/**
 * The organization workspace is for users who look across properties:
 * organization-scope grants or more than one property. What they then see
 * is still limited to the properties they can access.
 */
export function canUseOrganizationWorkspace(me: MeView): boolean {
  return me.user.isSuperAdmin || me.organizationPermissions.length > 0 || me.properties.length > 1;
}

/** UI gating only: the permission at organization level or at any accessible property. */
export function holdsAnywhere(me: MeView, permission: Permission): boolean {
  return (
    me.user.isSuperAdmin ||
    me.organizationPermissions.includes(permission) ||
    me.properties.some((p) => p.permissions.includes(permission))
  );
}

/** Sections of the organization workspace; `visible` mirrors the server's checks. */
export const ORGANIZATION_SECTIONS: {
  segment: string;
  label: string;
  visible: (me: MeView) => boolean;
}[] = [
  { segment: "", label: "Overview", visible: () => true },
  { segment: "reports", label: "Reports", visible: (me) => holdsAnywhere(me, "reports:read") },
  {
    segment: "availability",
    label: "Availability",
    visible: (me) => holdsAnywhere(me, "search:global") && holdsAnywhere(me, "availability:read"),
  },
  { segment: "audit", label: "Audit trail", visible: (me) => holdsAnywhere(me, "audit:read") },
  {
    segment: "users",
    label: "Users & roles",
    visible: (me) => holdsAnywhere(me, "users:read") || holdsAnywhere(me, "users:manage"),
  },
  { segment: "properties", label: "Properties", visible: () => true },
];
