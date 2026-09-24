/**
 * Demo organization for development (SEED_DEMO=true). Created through the
 * domain services (organization bootstrap, property creation, business-date
 * initialization) so demo data obeys the same rules as real data.
 * Idempotent: skipped when the demo organization already exists.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../lib/auth/password";
import { prisma } from "../../lib/db/prisma";
import type { PropertyContext, SessionContext } from "../../lib/http/context";
import { ALL_PERMISSIONS } from "../../lib/permissions/catalog";
import { bootstrapOrganization } from "../../modules/access/access.service";
import { localDateInZone } from "../../modules/business-date/business-date.policy";
import { initializeBusinessDate } from "../../modules/business-date/business-date.service";
import { createProperty } from "../../modules/properties/properties.service";

const ORG_CODE = "SERENE";

const PROPERTIES = [
  {
    code: "SMR",
    name: "Serene Mountain Resort",
    timezone: "Asia/Karachi",
    currencyCode: "PKR",
    countryCode: "PK",
    city: "Nathia Gali",
  },
  {
    code: "SDX",
    name: "Serene City Hotel Dubai",
    timezone: "Asia/Dubai",
    currencyCode: "AED",
    countryCode: "AE",
    city: "Dubai",
  },
] as const;

/** [email local part, display name, role code, scope: "ORG" or property codes] */
const USERS: [string, string, string, "ORG" | readonly string[]][] = [
  ["admin", "Organization Admin", "ORGANIZATION_ADMIN", "ORG"],
  ["gm.smr", "Ayesha Khan (GM, Mountain Resort)", "GENERAL_MANAGER", ["SMR"]],
  ["fom.smr", "Bilal Ahmed (Front Office Manager)", "FRONT_OFFICE_MANAGER", ["SMR"]],
  ["agent.smr", "Sara Malik (Front Desk)", "FRONT_DESK_AGENT", ["SMR"]],
  ["hk.smr", "Imran Ali (Housekeeping)", "HOUSEKEEPER", ["SMR"]],
  ["gm.sdx", "Omar Haddad (GM, City Hotel)", "GENERAL_MANAGER", ["SDX"]],
  ["auditor", "Nadia Rahman (Auditor, both hotels)", "AUDITOR", ["SMR", "SDX"]],
];

export async function seedDemo(): Promise<void> {
  if (await prisma.organization.findUnique({ where: { code: ORG_CODE }, select: { id: true } })) {
    console.warn("Demo organization already exists; skipping demo seed.");
    return;
  }

  const password =
    process.env.SEED_DEMO_PASSWORD ?? `Serene-${randomBytes(9).toString("base64url")}`;
  const passwordHash = await hashPassword(password);

  const organization = await prisma.$transaction((tx) =>
    bootstrapOrganization(tx, {
      code: ORG_CODE,
      name: "Serene Hospitality Group",
      legalName: "Serene Hospitality Group (Demo)",
      baseCurrency: "PKR",
    }),
  );

  const admin = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: "admin@serene.test",
      displayName: USERS[0]![1],
      passwordHash,
      passwordChangedAt: new Date(),
      status: "ACTIVE",
    },
    select: { id: true },
  });
  await prisma.userRoleAssignment.create({
    data: {
      userId: admin.id,
      roleId: roleId(organization.roleIdsByCode, "ORGANIZATION_ADMIN"),
      scope: "ORGANIZATION",
      grantedById: admin.id,
    },
  });

  // The seed acts as the organization admin; audit records attribute to it.
  const adminCtx: SessionContext = {
    requestId: "seed-demo",
    ipAddress: null,
    userAgent: "prisma-seed",
    userId: admin.id,
    organizationId: organization.id,
    sessionId: "seed",
    access: {
      userId: admin.id,
      organizationId: organization.id,
      isSuperAdmin: false,
      organizationPermissions: ALL_PERMISSIONS,
      byProperty: {},
    },
  };

  const propertyIds: Record<string, string> = {};
  for (const spec of PROPERTIES) {
    const property = await createProperty(adminCtx, {
      ...spec,
      checkInTime: "14:00",
      checkOutTime: "12:00",
      reason: "Demo data seed",
    });
    propertyIds[spec.code] = property.id;
    const propertyCtx: PropertyContext = {
      ...adminCtx,
      propertyId: property.id,
      propertyCode: property.code,
      timezone: property.timezone,
      businessDate: null,
    };
    await initializeBusinessDate(propertyCtx, {
      date: localDateInZone(new Date(), property.timezone),
      reason: "Demo data seed: go-live",
    });
  }

  for (const [local, displayName, role, scope] of USERS.slice(1)) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: `${local}@serene.test`,
        displayName,
        passwordHash,
        passwordChangedAt: new Date(),
        status: "ACTIVE",
        defaultPropertyId: scope === "ORG" ? null : (propertyIds[scope[0]!] ?? null),
      },
      select: { id: true },
    });
    const grants =
      scope === "ORG"
        ? [{ scope: "ORGANIZATION" as const, propertyId: null }]
        : scope.map((code) => ({ scope: "PROPERTY" as const, propertyId: propertyIds[code]! }));
    await prisma.userRoleAssignment.createMany({
      data: grants.map((grant) => ({
        userId: user.id,
        roleId: roleId(organization.roleIdsByCode, role),
        scope: grant.scope,
        propertyId: grant.propertyId,
        grantedById: admin.id,
      })),
    });
  }

  console.warn(
    [
      "",
      "Demo organization SERENE created with properties SMR (Asia/Karachi) and SDX (Asia/Dubai).",
      `Users (all share one password): ${USERS.map(([local]) => `${local}@serene.test`).join(", ")}`,
      process.env.SEED_DEMO_PASSWORD
        ? "Password: the value of SEED_DEMO_PASSWORD."
        : `Generated demo password (shown once, store it now): ${password}`,
      "",
    ].join("\n"),
  );
}

function roleId(roleIdsByCode: Record<string, string>, code: string): string {
  const id = roleIdsByCode[code];
  if (!id) throw new Error(`Role template ${code} is missing`);
  return id;
}
