import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import type { PropertyContext, SessionContext } from "@/lib/http/context";
import { ALL_PERMISSIONS } from "@/lib/permissions/catalog";
import type { RoleCode } from "@/lib/permissions/roles";
import { bootstrapOrganization } from "@/modules/access/access.service";
import { addDays, localDateInZone } from "@/modules/business-date/business-date.policy";
import { guestSearchName } from "@/modules/guests/guests.policy";
import { type TaxSpec, buildPropertyInventory } from "@/prisma/seed/inventory-builder";
import { initializeBusinessDate } from "@/modules/business-date/business-date.service";
import { createProperty } from "@/modules/properties/properties.service";
import { uniqueSuffix } from "./http";

/**
 * Builds an isolated organization per test file (unique codes and emails),
 * so integration test files can run in parallel against one database.
 */

export const TEST_PASSWORD = "Correct-Horse-Battery-9";
let passwordHash: Promise<string> | undefined;

export interface FixtureOrg {
  organizationId: string;
  suffix: string;
  roleIds: Record<string, string>;
  properties: Record<string, { id: string; code: string; timezone: string }>;
  adminId: string;
  adminCtx: SessionContext;
}

export async function createFixtureOrg(options: {
  properties: { key: string; timezone: string; live?: boolean }[];
}): Promise<FixtureOrg> {
  const suffix = uniqueSuffix();
  const org = await prisma.$transaction((tx) =>
    bootstrapOrganization(tx, {
      code: `T${suffix}`,
      name: `Test Org ${suffix}`,
      baseCurrency: "PKR",
    }),
  );
  passwordHash ??= hashPassword(TEST_PASSWORD);

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `admin.${suffix.toLowerCase()}@serene.test`,
      displayName: `Admin ${suffix}`,
      passwordHash: await passwordHash,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  await prisma.userRoleAssignment.create({
    data: {
      userId: admin.id,
      roleId: org.roleIdsByCode.ORGANIZATION_ADMIN!,
      scope: "ORGANIZATION",
      grantedById: admin.id,
    },
  });

  const adminCtx: SessionContext = {
    requestId: `fixture-${suffix}`,
    ipAddress: null,
    userAgent: "vitest-fixture",
    userId: admin.id,
    organizationId: org.id,
    sessionId: "fixture",
    access: {
      userId: admin.id,
      organizationId: org.id,
      isSuperAdmin: false,
      organizationPermissions: ALL_PERMISSIONS,
      byProperty: {},
    },
  };

  const properties: FixtureOrg["properties"] = {};
  let index = 0;
  for (const spec of options.properties) {
    index += 1;
    const code = `P${index}${suffix.slice(0, 6)}`;
    const property = await createProperty(adminCtx, {
      code,
      name: `Property ${spec.key} ${suffix}`,
      timezone: spec.timezone,
      currencyCode: "PKR",
      countryCode: "PK",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      reason: "Test fixture",
    });
    if (spec.live !== false) {
      const ctx: PropertyContext = {
        ...adminCtx,
        propertyId: property.id,
        propertyCode: property.code,
        timezone: property.timezone,
        currencyCode: property.currencyCode,
        businessDate: null,
      };
      await initializeBusinessDate(ctx, {
        date: localDateInZone(new Date(), spec.timezone),
        reason: "Test fixture",
      });
    }
    properties[spec.key] = { id: property.id, code: property.code, timezone: property.timezone };
  }

  return {
    organizationId: org.id,
    suffix,
    roleIds: org.roleIdsByCode,
    properties,
    adminId: admin.id,
    adminCtx,
  };
}

/** Creates an ACTIVE user with the given role grants; returns id and email. */
export async function createUser(
  org: FixtureOrg,
  localPart: string,
  grants: { role: RoleCode; property?: string }[],
  overrides: { status?: "ACTIVE" | "DISABLED" | "INVITED" } = {},
) {
  passwordHash ??= hashPassword(TEST_PASSWORD);
  const email = `${localPart}.${org.suffix.toLowerCase()}@serene.test`;
  const user = await prisma.user.create({
    data: {
      organizationId: org.organizationId,
      email,
      displayName: `${localPart} ${org.suffix}`,
      passwordHash: await passwordHash,
      status: overrides.status ?? "ACTIVE",
    },
    select: { id: true },
  });
  for (const grant of grants) {
    const propertyId = grant.property ? org.properties[grant.property]!.id : null;
    await prisma.userRoleAssignment.create({
      data: {
        userId: user.id,
        roleId: org.roleIds[grant.role]!,
        scope: propertyId ? "PROPERTY" : "ORGANIZATION",
        propertyId,
        grantedById: org.adminId,
      },
    });
  }
  return { id: user.id, email };
}

export function auditLogsFor(resourceId: string) {
  return prisma.auditLog.findMany({ where: { resourceId }, orderBy: { createdAt: "asc" } });
}

/**
 * Reservation prerequisites (room types, rooms, codes, rate plans) for a
 * fixture property, via the same builder the demo seed uses.
 */
export async function buildFixtureInventory(
  org: FixtureOrg,
  propertyKey: string,
  roomTypes: {
    code: string;
    rooms: number;
    maxOccupancy?: number;
    oneAdult?: string;
    twoAdults?: string;
  }[],
  options: { taxes?: TaxSpec[] } = {},
) {
  const property = org.properties[propertyKey]!;
  const current = await prisma.businessDate.findFirstOrThrow({
    where: { propertyId: property.id, isCurrent: true },
    select: { date: true },
  });
  const businessDate = current.date.toISOString().slice(0, 10);
  const inventory = await buildPropertyInventory(prisma, {
    propertyId: property.id,
    currencyCode: "PKR",
    seasonStart: addDays(businessDate, -10),
    seasonEnd: addDays(businessDate, 400),
    roomTypes: roomTypes.map((rt) => ({
      code: rt.code,
      name: `${rt.code} room`,
      rooms: rt.rooms,
      maxOccupancy: rt.maxOccupancy ?? 3,
      maxAdults: rt.maxOccupancy ?? 3,
      maxChildren: 1,
      oneAdult: rt.oneAdult ?? "10000",
      twoAdults: rt.twoAdults ?? "12000",
      extraAdult: "2000",
      extraChild: "1000",
      weekendUplift: "3000",
    })),
    taxes: options.taxes,
  });
  return { ...inventory, businessDate };
}

export async function createGuestRow(org: FixtureOrg, firstName: string, lastName: string) {
  return prisma.guest.create({
    data: {
      organizationId: org.organizationId,
      profileNumber: `T${org.suffix}${firstName.slice(0, 3).toUpperCase()}`.slice(0, 20),
      firstName,
      lastName,
      searchName: guestSearchName(firstName, lastName),
    },
    select: { id: true },
  });
}
