import { describe, expect, it } from "vitest";
import { organizationSections } from "@/global/components/workspace/sections";
import { ROLE_TEMPLATES } from "@serene/shared/lib/permissions/roles";
import type { MeView } from "@serene/shared/modules/access/access.types";

/**
 * Moved from the server integration test general-manager-access: the labels of
 * the organization workspace ("More") for the organization administrator and a
 * single-property general manager, derived from the role templates.
 */

function meFor(role: "ORGANIZATION_ADMIN" | "GENERAL_MANAGER", organizationWide: boolean): MeView {
  const permissions = [...ROLE_TEMPLATES[role].permissions];
  const properties = organizationWide ? ["a", "b"] : ["a"];
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
    organizationPermissions: organizationWide ? permissions : [],
    properties: properties.map((id) => ({
      id,
      code: id.toUpperCase(),
      name: id,
      timezone: "Asia/Karachi",
      currencyCode: "PKR",
      permissions,
    })),
    defaultPropertyCode: "A",
  };
}

describe("organization sections by role", () => {
  it("gives account 1 Properties under More, and the single-property GM no Properties", () => {
    expect(organizationSections(meFor("ORGANIZATION_ADMIN", true)).map((s) => s.label)).toEqual([
      "Overview",
      "Reports",
      "Availability",
      "Audit trail",
      "Users & roles",
      "Properties",
    ]);
    // The GM template excludes properties:manage; one property is no cross-property view.
    expect(organizationSections(meFor("GENERAL_MANAGER", false)).map((s) => s.label)).toEqual([
      "Reports",
      "Availability",
      "Audit trail",
      "Users & roles",
    ]);
  });
});
