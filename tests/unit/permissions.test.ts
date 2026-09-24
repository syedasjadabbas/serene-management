import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSIONS, isPermission } from "@/lib/permissions/catalog";
import { canAccessProperty, hasPermission, type AccessProfile } from "@/lib/permissions/evaluate";
import { ROLE_TEMPLATES } from "@/lib/permissions/roles";

describe("permission catalog", () => {
  it("uses resource:action keys", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key).toMatch(/^[a-z]+:[a-z_]+$/);
    }
  });

  it("role templates reference only catalog permissions, without duplicates", () => {
    for (const [code, role] of Object.entries(ROLE_TEMPLATES)) {
      const perms: readonly string[] = role.permissions;
      expect(perms.every(isPermission), code).toBe(true);
      expect(new Set(perms).size, `${code} has duplicate permissions`).toBe(perms.length);
    }
  });

  it("keeps high-risk permissions out of line-staff roles", () => {
    const lineStaff = [
      ROLE_TEMPLATES.HOUSEKEEPER,
      ROLE_TEMPLATES.MAINTENANCE_STAFF,
      ROLE_TEMPLATES.CASHIER,
    ];
    for (const role of lineStaff) {
      const risky = role.permissions.filter((p) => "highRisk" in PERMISSIONS[p]);
      expect(risky).toEqual([]);
    }
  });
});

describe("permission evaluation", () => {
  const access: AccessProfile = {
    userId: "u1",
    organizationId: "o1",
    isSuperAdmin: false,
    byProperty: { p1: ["reservations:read", "frontdesk:checkin"] },
  };

  it("grants only what the property grant contains", () => {
    expect(hasPermission(access, "p1", "frontdesk:checkin")).toBe(true);
    expect(hasPermission(access, "p1", "payments:refund")).toBe(false);
  });

  it("isolates properties", () => {
    expect(canAccessProperty(access, "p2")).toBe(false);
    expect(hasPermission(access, "p2", "reservations:read")).toBe(false);
  });

  it("lets platform super admins through", () => {
    expect(hasPermission({ ...access, isSuperAdmin: true }, "p2", "nightaudit:run")).toBe(true);
  });
});
