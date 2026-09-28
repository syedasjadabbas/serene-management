/**
 * Builds the reservation prerequisites of a property directly in the database:
 * floors, room types, rooms, reservation types, market/source codes, channels,
 * cancellation policies, reason codes, a room transaction code, and rate plans
 * with seasons. Used by the demo seed and by integration tests.
 *
 * Configuration screens for these arrive in later phases (rooms, rates); this
 * builder is the interim, deterministic way to create them.
 */
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { formatMoney, parseMoney } from "../../lib/utils/money";
import { applyStarterSetup } from "../../modules/properties/starter-setup.repository";

type Db = PrismaClient | Prisma.TransactionClient;

export interface RoomTypeSpec {
  code: string;
  name: string;
  rooms: number;
  maxOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  /** Base (weekday) prices as decimal strings. */
  oneAdult: string;
  twoAdults?: string;
  extraAdult?: string;
  extraChild?: string;
  /** Weekend (Fri/Sat) uplift as decimal string added to every base price. */
  weekendUplift?: string;
}

export interface InventorySpec {
  propertyId: string;
  currencyCode: string;
  /** First date covered by rate seasons (inclusive). */
  seasonStart: string;
  /** Last date covered by rate seasons (inclusive). */
  seasonEnd: string;
  roomTypes: RoomTypeSpec[];
  roomsPerFloor?: number;
  /** Tax / service-charge rules (Phase 5); none when omitted. */
  taxes?: TaxSpec[];
  /** Breakfast price per person for the demo bed & breakfast package (Phase 6). */
  breakfastPrice?: string;
}

export interface TaxSpec {
  code: string;
  name: string;
  calculation: "PERCENT" | "FLAT_PER_UNIT";
  basis: "NET" | "COMPOUND";
  /** Percent ("16") or flat amount per unit, as a decimal string. */
  rate: string;
  /** Application order on a code (compound taxes include earlier ones). */
  sequence: number;
  bucket?: "TAX" | "SERVICE_CHARGE";
  /** Charge codes (e.g. "1000") that generate this tax. */
  appliesTo: string[];
}

export interface BuiltInventory {
  roomTypes: Record<string, { id: string; roomIds: string[]; roomNumbers: string[] }>;
  ratePlans: Record<string, string>;
  reservationTypes: Record<string, string>;
  marketCodes: Record<string, string>;
  sourceCodes: Record<string, string>;
  channels: Record<string, string>;
  reasonCodes: Record<string, string>;
  cancellationPolicies: Record<string, string>;
  taskTypes: Record<string, string>;
  maintenanceCategories: Record<string, string>;
  /** Transaction code ids by code ("1000", "2000", tax and payment codes). */
  chargeCodes: Record<string, string>;
  paymentMethods: Record<string, string>;
  taxRules: Record<string, string>;
  /** Block statuses by code: INQ, TENT, DEF, LOST (Phase 6). */
  blockStatuses: Record<string, string>;
  packages: Record<string, string>;
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function addDecimal(a: string, b: string): string {
  return formatMoney(parseMoney(a) + parseMoney(b));
}

/** Reference data a property copies (D37): what `copyPropertySetup` reproduces. */
export type ReferenceSetup = Omit<
  BuiltInventory,
  "roomTypes" | "ratePlans" | "taxRules" | "packages"
>;

/**
 * Reference setup of a property: the standard starter setup (D49), shared
 * with the application's first-property path. Idempotent by code.
 */
export function buildReferenceSetup(db: Db, propertyId: string): Promise<ReferenceSetup> {
  return applyStarterSetup(db, propertyId);
}

export async function buildPropertyInventory(db: Db, spec: InventorySpec): Promise<BuiltInventory> {
  const { propertyId } = spec;
  const upsertByCode = <T extends { id: string }>(existing: T | null, create: () => Promise<T>) =>
    existing ? Promise.resolve(existing) : create();

  const reference = await buildReferenceSetup(db, propertyId);
  const {
    reservationTypes,
    marketCodes,
    sourceCodes,
    channels,
    reasonCodes,
    cancellationPolicies,
    taskTypes,
    maintenanceCategories,
    chargeCodes,
    paymentMethods,
    blockStatuses,
  } = reference;
  const roomCharge = { id: chargeCodes["1000"]! };
  const taxGroup = await db.transactionCodeGroup.findFirst({
    where: { propertyId, code: "TAX" },
    select: { id: true },
  });
  const groups = { TAX: taxGroup!.id };
  const upsertCode = async (
    code: string,
    data: Omit<Prisma.TransactionCodeUncheckedCreateInput, "propertyId" | "code">,
  ) => {
    const row = await upsertByCode(
      await db.transactionCode.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.transactionCode.create({ data: { propertyId, code, ...data }, select: { id: true } }),
    );
    chargeCodes[code] = row.id;
    return row.id;
  };

  const taxRules: Record<string, string> = {};
  for (const [index, tax] of (spec.taxes ?? []).entries()) {
    const transactionCodeId = await upsertCode(String(8000 + index * 10), {
      groupId: groups.TAX!,
      name: tax.name,
      bucket: tax.bucket ?? "TAX",
      isManualPostAllowed: false,
    });
    const rule = await upsertByCode(
      await db.taxRule.findFirst({ where: { propertyId, code: tax.code }, select: { id: true } }),
      () =>
        db.taxRule.create({
          data: {
            propertyId,
            code: tax.code,
            name: tax.name,
            calculation: tax.calculation,
            basis: tax.basis,
            rate: tax.rate,
            transactionCodeId,
            effectiveFrom: date(spec.seasonStart),
          },
          select: { id: true },
        }),
    );
    taxRules[tax.code] = rule.id;
    for (const code of tax.appliesTo) {
      const codeId = chargeCodes[code];
      if (!codeId) throw new Error(`Tax ${tax.code} applies to unknown code ${code}`);
      await db.transactionCodeTax.upsert({
        where: { transactionCodeId_taxRuleId: { transactionCodeId: codeId, taxRuleId: rule.id } },
        update: {},
        create: {
          propertyId,
          transactionCodeId: codeId,
          taxRuleId: rule.id,
          sequence: tax.sequence,
        },
      });
    }
  }

  // Floors, room types, rooms ------------------------------------------------------
  const roomsPerFloor = spec.roomsPerFloor ?? 12;
  const totalRooms = spec.roomTypes.reduce((n, rt) => n + rt.rooms, 0);
  const floorCount = Math.max(1, Math.ceil(totalRooms / roomsPerFloor));
  const floors: string[] = [];
  for (let level = 1; level <= floorCount; level++) {
    const row = await upsertByCode(
      await db.floor.findFirst({ where: { propertyId, code: `F${level}` }, select: { id: true } }),
      () =>
        db.floor.create({
          data: { propertyId, code: `F${level}`, name: `Floor ${level}`, level },
          select: { id: true },
        }),
    );
    floors.push(row.id);
  }

  const roomTypes: BuiltInventory["roomTypes"] = {};
  let roomIndex = 0;
  for (const [order, rt] of spec.roomTypes.entries()) {
    const type = await upsertByCode(
      await db.roomType.findFirst({ where: { propertyId, code: rt.code }, select: { id: true } }),
      () =>
        db.roomType.create({
          data: {
            propertyId,
            code: rt.code,
            name: rt.name,
            maxOccupancy: rt.maxOccupancy,
            maxAdults: rt.maxAdults,
            maxChildren: rt.maxChildren,
            defaultOccupancy: Math.min(2, rt.maxOccupancy),
            sortOrder: order,
          },
          select: { id: true },
        }),
    );
    const roomIds: string[] = [];
    const roomNumbers: string[] = [];
    for (let i = 0; i < rt.rooms; i++) {
      const floorLevel = Math.floor(roomIndex / roomsPerFloor) + 1;
      const number = `${floorLevel}${String((roomIndex % roomsPerFloor) + 1).padStart(2, "0")}`;
      roomIndex++;
      const room = await upsertByCode(
        await db.room.findFirst({ where: { propertyId, number }, select: { id: true } }),
        () =>
          db.room.create({
            data: {
              propertyId,
              roomTypeId: type.id,
              floorId: floors[floorLevel - 1]!,
              number,
              housekeepingStatus: i % 4 === 0 ? "DIRTY" : "CLEAN",
              sortOrder: roomIndex,
            },
            select: { id: true },
          }),
      );
      roomIds.push(room.id);
      roomNumbers.push(number);
    }
    roomTypes[rt.code] = { id: type.id, roomIds, roomNumbers };
  }

  // Rate plans ---------------------------------------------------------------------
  const category = await upsertByCode(
    await db.rateCategory.findFirst({ where: { propertyId, code: "PUB" }, select: { id: true } }),
    () =>
      db.rateCategory.create({
        data: { propertyId, code: "PUB", name: "Public rates", rateClass: "TRANSIENT" },
        select: { id: true },
      }),
  );
  const ratePlans: Record<string, string> = {};
  const ensurePlan = async (
    code: string,
    data: Omit<Prisma.RatePlanUncheckedCreateInput, "propertyId" | "code">,
  ) => {
    const existing = await db.ratePlan.findFirst({
      where: { propertyId, code },
      select: { id: true },
    });
    const plan =
      existing ??
      (await db.ratePlan.create({ data: { propertyId, code, ...data }, select: { id: true } }));
    ratePlans[code] = plan.id;
    for (const { id } of Object.values(roomTypes)) {
      await db.ratePlanRoomType.upsert({
        where: { ratePlanId_roomTypeId: { ratePlanId: plan.id, roomTypeId: id } },
        create: { propertyId, ratePlanId: plan.id, roomTypeId: id },
        update: {},
      });
    }
    return plan.id;
  };

  const barId = await ensurePlan("BAR", {
    name: "Best available rate",
    categoryId: category.id,
    kind: "BAR",
    currencyCode: spec.currencyCode,
    roomTransactionCodeId: roomCharge.id,
    defaultMarketCodeId: marketCodes.BAR,
    defaultSourceCodeId: sourceCodes.DIR,
    cancellationPolicyId: cancellationPolicies["24H"],
    displayOrder: 1,
  });
  await ensurePlan("ADV", {
    name: "Advance purchase (-10%)",
    categoryId: category.id,
    kind: "PROMOTIONAL",
    currencyCode: spec.currencyCode,
    roomTransactionCodeId: roomCharge.id,
    parentRatePlanId: barId,
    derivationType: "PERCENT",
    derivationValue: "-10",
    roundingIncrement: "1",
    defaultMarketCodeId: marketCodes.LEI,
    defaultSourceCodeId: sourceCodes.WEB,
    cancellationPolicyId: cancellationPolicies.NRF,
    displayOrder: 2,
  });

  // Phase 7: a corporate negotiated rate, sold only to companies linked to it
  // (negotiated_rates); never quoted publicly.
  await ensurePlan("CORP", {
    name: "Corporate negotiated (-12%)",
    categoryId: category.id,
    kind: "NEGOTIATED",
    requiresNegotiation: true,
    currencyCode: spec.currencyCode,
    roomTransactionCodeId: roomCharge.id,
    parentRatePlanId: barId,
    derivationType: "PERCENT",
    derivationValue: "-12",
    roundingIncrement: "1",
    defaultMarketCodeId: marketCodes.COR,
    defaultSourceCodeId: sourceCodes.DIR,
    cancellationPolicyId: cancellationPolicies["24H"],
    displayOrder: 6,
  });

  // Phase 6 commercial configuration: a group rate, a bed & breakfast package
  // and the rate plan that includes it, and the configurable block statuses.
  await ensurePlan("GRP", {
    name: "Group rate (-15%)",
    categoryId: category.id,
    kind: "GROUP",
    currencyCode: spec.currencyCode,
    roomTransactionCodeId: roomCharge.id,
    parentRatePlanId: barId,
    derivationType: "PERCENT",
    derivationValue: "-15",
    roundingIncrement: "1",
    defaultMarketCodeId: marketCodes.GRP,
    defaultSourceCodeId: sourceCodes.DIR,
    cancellationPolicyId: cancellationPolicies["24H"],
    displayOrder: 5,
  });
  const packages: Record<string, string> = {};
  const breakfast = await upsertByCode(
    await db.package.findFirst({ where: { propertyId, code: "BB" }, select: { id: true } }),
    () =>
      db.package.create({
        data: {
          propertyId,
          code: "BB",
          name: "Bed & breakfast",
          description: "Breakfast for every guest, every night",
          postingType: "INCLUDED_IN_RATE",
          sellSeparately: true,
          components: {
            create: {
              name: "Breakfast",
              transactionCodeId: chargeCodes["2030"]!,
              calculation: "PER_PERSON",
              postingRhythm: "EVERY_NIGHT",
              unitPrice: spec.breakfastPrice ?? "1500",
            },
          },
        },
        select: { id: true },
      }),
  );
  packages.BB = breakfast.id;
  const bbkId = await ensurePlan("BBK", {
    name: "Bed & breakfast",
    categoryId: category.id,
    kind: "PACKAGE",
    currencyCode: spec.currencyCode,
    roomTransactionCodeId: roomCharge.id,
    parentRatePlanId: barId,
    derivationType: "PERCENT",
    derivationValue: "12",
    roundingIncrement: "1",
    defaultMarketCodeId: marketCodes.LEI,
    defaultSourceCodeId: sourceCodes.DIR,
    cancellationPolicyId: cancellationPolicies["24H"],
    displayOrder: 3,
  });
  await db.ratePlanPackage.upsert({
    where: { ratePlanId_packageId: { ratePlanId: bbkId, packageId: breakfast.id } },
    create: { propertyId, ratePlanId: bbkId, packageId: breakfast.id },
    update: {},
  });

  if ((await db.rateSeason.count({ where: { ratePlanId: barId } })) === 0) {
    for (const [name, daysOfWeek, priority, weekend] of [
      ["Base", 127, 0, false],
      ["Weekend (Fri, Sat)", 16 + 32, 10, true],
    ] as const) {
      const season = await db.rateSeason.create({
        data: {
          propertyId,
          ratePlanId: barId,
          name,
          startDate: date(spec.seasonStart),
          endDate: date(spec.seasonEnd),
          daysOfWeek,
          priority,
        },
        select: { id: true },
      });
      for (const rt of spec.roomTypes) {
        const uplift = weekend ? (rt.weekendUplift ?? "0") : "0";
        await db.rateSeasonAmount.create({
          data: {
            propertyId,
            seasonId: season.id,
            roomTypeId: roomTypes[rt.code]!.id,
            oneAdult: addDecimal(rt.oneAdult, uplift),
            twoAdults: rt.twoAdults ? addDecimal(rt.twoAdults, uplift) : null,
            extraAdult: rt.extraAdult ?? null,
            extraChild: rt.extraChild ?? null,
          },
        });
      }
    }
  }

  return {
    roomTypes,
    ratePlans,
    reservationTypes,
    marketCodes,
    sourceCodes,
    channels,
    reasonCodes,
    cancellationPolicies,
    taskTypes,
    maintenanceCategories,
    chargeCodes,
    paymentMethods,
    taxRules,
    blockStatuses,
    packages,
  };
}
