import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  isPermission,
} from "@serene/shared/lib/permissions/catalog";
import {
  type AccessProfile,
  canAccessProperty,
  hasOrganizationPermission,
  hasPermission,
  hasPermissionAnywhere,
  permissionsInScope,
} from "@serene/shared/lib/permissions/evaluate";
import { ROLE_TEMPLATES } from "@serene/shared/lib/permissions/roles";

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

/**
 * Reserved permissions: granted by role templates, but no feature checks them
 * yet. The list must stay accurate, so a reserved key that starts being checked
 * (or a regular key that stops being checked) fails here: promote the key by
 * removing `reserved: true` in the catalog, or restore its check.
 */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKIPPED_DIRS = new Set(["node_modules", ".next", "generated", "dist", "coverage", "tests"]);
// The catalog and the role templates only declare and grant; they never check.
const DECLARATION_FILES = new Set([
  "shared/lib/permissions/catalog.ts",
  "shared/lib/permissions/roles.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

const checkedSource = ["server", "client", "shared"]
  .flatMap((workspace) => sourceFiles(join(REPO_ROOT, workspace)))
  .filter((path) => !DECLARATION_FILES.has(relative(REPO_ROOT, path).split(sep).join("/")))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** A key counts as checked when it appears as a string literal or as the client's `P.RESOURCE_ACTION` constant. */
function isReferenced(key: string): boolean {
  const literal = new RegExp(`["'\`]${key}["'\`]`);
  const constant = new RegExp(`\\bP\\.${key.replace(":", "_").toUpperCase()}\\b`);
  return literal.test(checkedSource) || constant.test(checkedSource);
}

describe("reserved permissions", () => {
  it("lists exactly the keys no feature checks yet", () => {
    const unchecked = ALL_PERMISSIONS.filter((key) => !isReferenced(key));
    const reserved = [...RESERVED_PERMISSIONS];
    expect(unchecked.sort()).toEqual(reserved.sort());
  });
});

describe("permission evaluation", () => {
  const access: AccessProfile = {
    userId: "u1",
    organizationId: "o1",
    isSuperAdmin: false,
    organizationPermissions: [],
    byProperty: { p1: ["reservations:read", "frontdesk:checkin", "users:manage"] },
  };

  it("grants only what the property grant contains", () => {
    expect(hasPermission(access, "p1", "frontdesk:checkin")).toBe(true);
    expect(hasPermission(access, "p1", "payments:refund")).toBe(false);
  });

  it("isolates properties", () => {
    expect(canAccessProperty(access, "p2")).toBe(false);
    expect(hasPermission(access, "p2", "reservations:read")).toBe(false);
  });

  it("does not treat property grants as organization grants", () => {
    expect(hasOrganizationPermission(access, "users:manage")).toBe(false);
    expect(hasPermissionAnywhere(access, "users:manage")).toBe(true);
    expect(permissionsInScope(access, null)).toEqual([]);
    expect(permissionsInScope(access, "p1")).toContain("users:manage");
  });

  it("lets organization grants authorize organization-level actions", () => {
    const orgAdmin: AccessProfile = { ...access, organizationPermissions: ["properties:manage"] };
    expect(hasOrganizationPermission(orgAdmin, "properties:manage")).toBe(true);
  });

  it("lets super admins act only within properties resolved for them", () => {
    const superAdmin: AccessProfile = {
      ...access,
      isSuperAdmin: true,
      byProperty: { p1: [], p2: [] },
    };
    expect(hasPermission(superAdmin, "p2", "nightaudit:run")).toBe(true);
    expect(hasPermission(superAdmin, "p3", "nightaudit:run")).toBe(false);
    expect(hasOrganizationPermission(superAdmin, "roles:manage")).toBe(true);
  });
});
