import type { MeView } from "@/modules/access/access.types";
import type { Permission } from "@/lib/permissions/catalog";

/**
 * Sections of the property workspace, in navigation order, grouped on the
 * navigation rail by the kind of work (front office, rooms, revenue and
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
