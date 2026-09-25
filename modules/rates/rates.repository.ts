import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Active rate plans of a property with the seasons overlapping the stay and
 * their amounts. Rate plans per property are few (tens), so one query with
 * nested selects is bounded.
 */
export function findRatePlansForStay(
  tx: Tx,
  propertyId: string,
  firstNight: string,
  lastNight: string,
  /** Default: every ACTIVE plan (booking). The calendar passes a plan chain of any status. */
  where: Prisma.RatePlanWhereInput = { status: "ACTIVE" },
) {
  const first = new Date(`${firstNight}T00:00:00.000Z`);
  const last = new Date(`${lastNight}T00:00:00.000Z`);
  return tx.ratePlan.findMany({
    where: { propertyId, ...where },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      currencyCode: true,
      taxInclusive: true,
      parentRatePlanId: true,
      derivationType: true,
      derivationValue: true,
      roundingIncrement: true,
      sellFrom: true,
      sellTo: true,
      stayFrom: true,
      stayTo: true,
      requiresNegotiation: true,
      requiresMembership: true,
      isDayUse: true,
      displayOrder: true,
      cancellationPolicy: { select: { id: true, code: true, name: true, description: true } },
      roomTypes: { select: { roomTypeId: true } },
      // Companies this plan is negotiated for (requiresNegotiation, Phase 7).
      negotiated: { select: { accountProfileId: true, validFrom: true, validTo: true } },
      seasons: {
        where: { startDate: { lte: last }, endDate: { gte: first } },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          daysOfWeek: true,
          priority: true,
          amounts: {
            select: {
              roomTypeId: true,
              oneAdult: true,
              twoAdults: true,
              threeAdults: true,
              fourAdults: true,
              extraAdult: true,
              extraChild: true,
            },
          },
        },
      },
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}

export type RatePlanRow = Awaited<ReturnType<typeof findRatePlansForStay>>[number];

export function findCurrencyMinorUnits(tx: Tx, code: string) {
  return tx.currency.findUnique({ where: { code }, select: { minorUnits: true } });
}

// --- Locks -----------------------------------------------------------------------------

/** Active plans deriving directly from `ratePlanId` (they would lose their parent on deactivation). */
export function findActiveChildCodes(tx: Tx, propertyId: string, ratePlanId: string) {
  return tx.ratePlan.findMany({
    where: { propertyId, parentRatePlanId: ratePlanId, status: "ACTIVE" },
    select: { code: true },
    orderBy: { code: "asc" },
  });
}

/** A plan and its derivation ancestors (the plan first), within this property. */
export async function findPlanChainIds(
  tx: Tx,
  propertyId: string,
  ratePlanId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE chain AS (
      SELECT "id", "parent_rate_plan_id", 0 AS depth FROM "rate_plans"
      WHERE "id" = ${ratePlanId}::uuid AND "property_id" = ${propertyId}::uuid
      UNION ALL
      SELECT r."id", r."parent_rate_plan_id", c.depth + 1 FROM "rate_plans" r
      JOIN chain c ON r."id" = c."parent_rate_plan_id" WHERE c.depth < 5
    )
    SELECT "id" FROM chain ORDER BY depth`;
  return rows.map((row) => row.id);
}

/**
 * Locks a rate plan and its derivation ancestors (ARCHITECTURE §5, step 3):
 * FOR SHARE while a booking prices a stay, FOR UPDATE while an administrator
 * changes the plan, so a price is never taken from a half-changed plan.
 */
export async function lockRatePlanChain(
  tx: Tx,
  propertyId: string,
  ratePlanId: string,
  mode: "share" | "update",
): Promise<{ id: string; version: number; status: string; parent_rate_plan_id: string | null }[]> {
  const chain = await findPlanChainIds(tx, propertyId, ratePlanId);
  if (chain.length === 0) return [];
  const ids = Prisma.join(chain.map((id) => Prisma.sql`${id}::uuid`));
  const lock = mode === "share" ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`;
  return tx.$queryRaw`
    SELECT "id", "version", "status"::text AS "status", "parent_rate_plan_id"
    FROM "rate_plans" WHERE "id" IN (${ids}) ORDER BY "id" ${lock}`;
}

// --- Administration ------------------------------------------------------------------------

export function findRatePlanList(tx: Tx, propertyId: string) {
  return tx.ratePlan.findMany({
    where: { propertyId },
    orderBy: [{ status: "asc" }, { displayOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      status: true,
      currencyCode: true,
      taxInclusive: true,
      version: true,
      displayOrder: true,
      derivationType: true,
      derivationValue: true,
      requiresNegotiation: true,
      parent: { select: { id: true, code: true } },
      roomTypes: { select: { roomType: { select: { code: true } } } },
      packages: { select: { package: { select: { code: true } } } },
      _count: { select: { seasons: true } },
    },
  });
}

export function findRatePlanDetail(tx: Tx, propertyId: string, id: string) {
  return tx.ratePlan.findFirst({
    where: { id, propertyId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      kind: true,
      status: true,
      currencyCode: true,
      taxInclusive: true,
      version: true,
      displayOrder: true,
      categoryId: true,
      parentRatePlanId: true,
      derivationType: true,
      derivationValue: true,
      roundingIncrement: true,
      sellFrom: true,
      sellTo: true,
      stayFrom: true,
      stayTo: true,
      cancellationPolicyId: true,
      depositPolicyId: true,
      defaultMarketCodeId: true,
      defaultSourceCodeId: true,
      roomTransactionCode: { select: { id: true, code: true, name: true } },
      parent: { select: { id: true, code: true } },
      roomTypes: { select: { roomTypeId: true } },
      packages: { select: { package: { select: { id: true, code: true, name: true } } } },
      derived: { select: { id: true, code: true, name: true } },
      requiresNegotiation: true,
      negotiated: {
        orderBy: { createdAt: "asc" },
        select: {
          validFrom: true,
          validTo: true,
          account: { select: { id: true, code: true, name: true } },
        },
      },
      seasons: {
        orderBy: [{ startDate: "asc" }, { priority: "desc" }],
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          daysOfWeek: true,
          priority: true,
          amounts: {
            select: {
              roomTypeId: true,
              roomType: { select: { code: true } },
              oneAdult: true,
              twoAdults: true,
              threeAdults: true,
              fourAdults: true,
              extraAdult: true,
              extraChild: true,
            },
          },
        },
      },
    },
  });
}

/** Every plan of the property with its derivation link (for chain validation). */
export function findPlanLinks(tx: Tx, propertyId: string) {
  return tx.ratePlan.findMany({
    where: { propertyId },
    select: { id: true, code: true, parentRatePlanId: true, status: true, currencyCode: true },
  });
}

export function insertRatePlan(tx: Tx, data: Prisma.RatePlanUncheckedCreateInput) {
  return tx.ratePlan.create({ data, select: { id: true } });
}

export function updateRatePlanVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.RatePlanUncheckedUpdateManyInput,
) {
  return tx.ratePlan.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export async function replacePlanRoomTypes(
  tx: Tx,
  propertyId: string,
  ratePlanId: string,
  roomTypeIds: string[],
) {
  await tx.ratePlanRoomType.deleteMany({ where: { ratePlanId } });
  await tx.ratePlanRoomType.createMany({
    data: roomTypeIds.map((roomTypeId) => ({ propertyId, ratePlanId, roomTypeId })),
  });
}

export async function replacePlanPackages(
  tx: Tx,
  propertyId: string,
  ratePlanId: string,
  packageIds: string[],
) {
  await tx.ratePlanPackage.deleteMany({ where: { ratePlanId } });
  await tx.ratePlanPackage.createMany({
    data: packageIds.map((packageId) => ({ propertyId, ratePlanId, packageId })),
  });
}

export function findSeasons(tx: Tx, ratePlanId: string) {
  return tx.rateSeason.findMany({
    where: { ratePlanId },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      daysOfWeek: true,
      priority: true,
    },
  });
}

export function findSeasonAmounts(tx: Tx, seasonId: string) {
  return tx.rateSeasonAmount.findMany({ where: { seasonId } });
}

export function insertSeason(tx: Tx, data: Prisma.RateSeasonUncheckedCreateInput) {
  return tx.rateSeason.create({ data, select: { id: true } });
}

export function updateSeason(tx: Tx, id: string, data: Prisma.RateSeasonUncheckedUpdateInput) {
  return tx.rateSeason.update({ where: { id }, data, select: { id: true } });
}

export async function replaceSeasonAmounts(
  tx: Tx,
  propertyId: string,
  seasonId: string,
  amounts: Omit<Prisma.RateSeasonAmountCreateManyInput, "propertyId" | "seasonId">[],
) {
  await tx.rateSeasonAmount.deleteMany({ where: { seasonId } });
  await tx.rateSeasonAmount.createMany({
    data: amounts.map((amount) => ({ ...amount, propertyId, seasonId })),
  });
}

export function deleteSeason(tx: Tx, id: string) {
  return tx.rateSeason.delete({ where: { id } });
}

/** Reference data for validation and form options (sequential: may run in a transaction). */
export async function findRateReferenceData(tx: Tx, propertyId: string) {
  const active = { propertyId, status: "ACTIVE" as const };
  const ref = { id: true, code: true, name: true } as const;
  return {
    roomTypes: await tx.roomType.findMany({
      where: { ...active, isPseudo: false },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: ref,
    }),
    roomChargeCodes: await tx.transactionCode.findMany({
      where: { ...active, bucket: "ROOM", group: { type: "REVENUE" } },
      orderBy: { code: "asc" },
      select: ref,
    }),
    packageChargeCodes: await tx.transactionCode.findMany({
      where: {
        ...active,
        bucket: { notIn: ["ROOM", "TAX", "PAYMENT", "NON_REVENUE"] },
        group: { type: "REVENUE" },
      },
      orderBy: { code: "asc" },
      select: ref,
    }),
    categories: await tx.rateCategory.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
    cancellationPolicies: await tx.cancellationPolicy.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
    depositPolicies: await tx.depositPolicy.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
    marketCodes: await tx.marketCode.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
    sourceCodes: await tx.sourceCode.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
    ratePlans: await tx.ratePlan.findMany({
      where: { propertyId },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { ...ref, status: true, parentRatePlanId: true },
    }),
    packages: await tx.package.findMany({
      where: { propertyId },
      orderBy: { code: "asc" },
      select: { ...ref, status: true, sellSeparately: true },
    }),
  };
}

// --- Packages ------------------------------------------------------------------------------

const packageSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  postingType: true,
  sellSeparately: true,
  status: true,
  ratePlans: { select: { ratePlan: { select: { code: true } } } },
  components: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      calculation: true,
      postingRhythm: true,
      daysOfWeek: true,
      unitPrice: true,
      transactionCode: { select: { id: true, code: true, name: true } },
    },
  },
} as const satisfies Prisma.PackageSelect;

export type PackageRow = Prisma.PackageGetPayload<{ select: typeof packageSelect }>;

export function findPackages(tx: Tx, propertyId: string) {
  return tx.package.findMany({
    where: { propertyId },
    orderBy: { code: "asc" },
    select: packageSelect,
  });
}

export function findPackage(tx: Tx, propertyId: string, id: string) {
  return tx.package.findFirst({ where: { id, propertyId }, select: packageSelect });
}

/** Serializes package edits (packages carry no version column). */
export async function lockPackage(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "packages"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows.length === 1;
}

export function insertPackage(tx: Tx, data: Prisma.PackageUncheckedCreateInput) {
  return tx.package.create({ data, select: { id: true } });
}

export function updatePackageRow(tx: Tx, id: string, data: Prisma.PackageUncheckedUpdateInput) {
  return tx.package.update({ where: { id }, data, select: { id: true } });
}

export function createComponent(tx: Tx, data: Prisma.PackageComponentUncheckedCreateInput) {
  return tx.packageComponent.create({ data, select: { id: true } });
}

export function updateComponent(
  tx: Tx,
  id: string,
  data: Prisma.PackageComponentUncheckedUpdateInput,
) {
  return tx.packageComponent.update({ where: { id }, data, select: { id: true } });
}

export function deleteComponents(tx: Tx, ids: string[]) {
  return tx.packageComponent.deleteMany({ where: { id: { in: ids } } });
}

/** Components with ledger postings may not be deleted (the posting keys reference them). */
export function countComponentPostings(tx: Tx, componentIds: string[]) {
  if (componentIds.length === 0) return Promise.resolve(0);
  return tx.folioItem.count({ where: { packageComponentId: { in: componentIds } } });
}

export function findActivePackages(tx: Tx, propertyId: string, ids: string[]) {
  return tx.package.findMany({
    where: { propertyId, id: { in: ids }, status: "ACTIVE" },
    select: { id: true, code: true, sellSeparately: true },
  });
}

/** Replaces the companies a plan is negotiated for (Phase 7). */
export async function replacePlanAccounts(
  tx: Tx,
  propertyId: string,
  ratePlanId: string,
  rows: { accountProfileId: string; validFrom: Date | null; validTo: Date | null }[],
) {
  await tx.negotiatedRate.deleteMany({ where: { propertyId, ratePlanId } });
  if (rows.length > 0) {
    await tx.negotiatedRate.createMany({
      data: rows.map((r) => ({ ...r, propertyId, ratePlanId })),
    });
  }
}

/** Active companies of the organization among `ids` (negotiated-rate links). */
export function findCompanies(tx: Tx, organizationId: string, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.accountProfile.findMany({
    where: { organizationId, id: { in: ids }, type: "COMPANY", status: "ACTIVE", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
}
