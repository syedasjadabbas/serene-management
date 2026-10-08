import { describe, expect, it } from "vitest";
import {
  organizationSections,
  propertySection,
  visiblePropertyNav,
} from "@/components/workspace/sections";
import type { Permission } from "@/lib/permissions/catalog";
import { ROLE_TEMPLATES, type RoleCode } from "@/lib/permissions/roles";
import type { MeView } from "@/modules/access/access.types";

/**
 * Navigation of every seeded role (prisma/seed/demo.ts: one property each,
 * the auditor two, the administrator organization-wide), derived from the
 * role templates (lib/permissions/roles.ts) through the same functions the
 * navigation bar renders with. The expected table below was checked row by
 * row against the templates: an item appears exactly when the role holds
 * the permission its page and API require (components/workspace/sections.ts).
 */

const property = (id: string, code: string, permissions: readonly Permission[]) => ({
  id,
  code,
  name: code,
  timezone: "Asia/Karachi",
  currencyCode: "PKR",
  permissions: [...permissions],
});

function meFor(role: RoleCode, scope: "ORG" | "ONE" | "TWO"): MeView {
  const permissions = ROLE_TEMPLATES[role].permissions;
  return {
    user: {
      id: "u",
      email: "u@x",
      displayName: "U",
      locale: "en",
      isSuperAdmin: false,
      avatarUrl: null,
    },
    organization: { id: "o", code: "O", name: "Org", baseCurrency: "PKR" },
    organizationPermissions: scope === "ORG" ? [...permissions] : [],
    properties:
      scope === "TWO"
        ? [property("a", "SMR", permissions), property("b", "SDX", permissions)]
        : [property("a", "SMR", permissions)],
    defaultPropertyCode: "SMR",
  };
}

/** "Label" for a link, "Label: item, item" for a menu; More last. */
function navOf(me: MeView): string[] {
  const held = new Set(me.properties[0]!.permissions);
  const nav = visiblePropertyNav((p) => held.has(p)).map((node) =>
    node.kind === "link"
      ? propertySection(node.segment).label
      : `${node.label}: ${node.items.map((i) => i.label ?? propertySection(i.segment).label).join(", ")}`,
  );
  const more = organizationSections(me).map((s) => (s.segment ? s.label : "Organization overview"));
  return more.length > 0 ? [...nav, `More: ${more.join(", ")}`] : nav;
}

/** Seeded scope: the administrator organization-wide, the auditor at two properties, everyone else at one. */
const SCOPE: Partial<Record<RoleCode, "ORG" | "TWO">> = {
  ORGANIZATION_ADMIN: "ORG",
  AUDITOR: "TWO",
};

const EXPECTED: Record<RoleCode, string[]> = {
  ORGANIZATION_ADMIN: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance, Property setup",
    "Revenue & finance: Rates, Packages, Billing",
    "Night audit",
    "Reports",
    "More: Organization overview, Reports, Availability, Audit trail, Users & roles, Properties",
  ],
  GENERAL_MANAGER: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance, Property setup",
    "Revenue & finance: Rates, Packages, Billing",
    "Night audit",
    "Reports",
    "More: Reports, Availability, Audit trail, Users & roles",
  ],
  FRONT_OFFICE_MANAGER: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance",
    "Revenue & finance: Rates, Packages, Billing",
    "Night audit",
    "Reports",
    "More: Reports, Availability, Audit trail",
  ],
  FRONT_DESK_AGENT: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance",
    "Revenue & finance: Rates, Packages, Billing",
    "Reports",
    "More: Reports, Availability",
  ],
  RESERVATIONS_AGENT: [
    "Dashboard",
    "Front office: Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Revenue & finance: Rates, Packages, Billing",
    "More: Availability",
  ],
  HOUSEKEEPING_MANAGER: [
    "Dashboard",
    "Front office: Front desk",
    "Rooms: Housekeeping, Maintenance",
    "Reports",
    "More: Reports",
  ],
  HOUSEKEEPER: ["Dashboard", "Rooms: Housekeeping"],
  MAINTENANCE_MANAGER: [
    "Dashboard",
    "Rooms: Housekeeping, Maintenance",
    "Reports",
    "More: Reports",
  ],
  MAINTENANCE_STAFF: ["Dashboard", "Rooms: Maintenance"],
  CASHIER: [
    "Dashboard",
    "Front office: Front desk, Reservations",
    "Guests: Guests, Companies",
    "Revenue & finance: Billing",
  ],
  ACCOUNTANT: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance",
    "Revenue & finance: Rates, Packages, Billing",
    "Night audit",
    "Reports",
    "More: Reports, Availability",
  ],
  AUDITOR: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance",
    "Revenue & finance: Rates, Packages, Billing",
    "Night audit",
    "Reports",
    "More: Organization overview, Reports, Availability, Audit trail, Properties",
  ],
  READ_ONLY: [
    "Dashboard",
    "Front office: Front desk, Reservations, Availability",
    "Guests: Guests, Companies, Groups, Loyalty",
    "Rooms: Housekeeping, Maintenance",
    "Revenue & finance: Rates, Packages, Billing",
    "Night audit",
    "Reports",
    "More: Reports, Availability",
  ],
};

describe("navigation of every seeded role", () => {
  it.each(Object.keys(ROLE_TEMPLATES) as RoleCode[])("%s", (role) => {
    expect(navOf(meFor(role, SCOPE[role] ?? "ONE"))).toEqual(EXPECTED[role]);
  });

  it("shows More exactly when at least one organization section is permitted", () => {
    for (const role of Object.keys(ROLE_TEMPLATES) as RoleCode[]) {
      const me = meFor(role, SCOPE[role] ?? "ONE");
      const hasMore = navOf(me).some((line) => line.startsWith("More:"));
      expect(hasMore, role).toBe(organizationSections(me).length > 0);
    }
  });

  it("offers Users & roles to a single-property holder of users:read or users:manage (accounts 2, 10)", () => {
    const gm = meFor("GENERAL_MANAGER", "ONE");
    expect(organizationSections(gm).map((s) => s.segment)).toContain("users");
    const fom = meFor("FRONT_OFFICE_MANAGER", "ONE");
    expect(organizationSections(fom).map((s) => s.segment)).not.toContain("users");
  });

  it("lists Rooms children by their own permissions, whichever item is first or last", () => {
    const only = (permissions: Permission[]) =>
      visiblePropertyNav((p) => permissions.includes(p)).map((n) =>
        n.kind === "group" ? n.id : n.segment,
      );
    expect(only(["maintenance:read"])).toEqual(["", "rooms"]);
    expect(only(["settings:read"])).toEqual(["", "rooms"]);
    expect(only([])).toEqual([""]);
  });
});
