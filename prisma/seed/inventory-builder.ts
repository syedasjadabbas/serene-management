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

/**
 * Chart of postable codes every property gets (Phase 5). Amounts are not
 * set here: prices are entered at posting time or come from rates/packages.
 */
const CHARGE_GROUPS = [
  ["FNB", "Food & beverage", "REVENUE", 2],
  ["MISC", "Guest services", "REVENUE", 3],
  ["TAX", "Taxes & service charges", "REVENUE", 8],
  ["PAY", "Payments", "PAYMENT", 9],
] as const;

const CHARGE_CODES = [
  ["2000", "Restaurant", "FNB", "FOOD_BEVERAGE"],
  ["2010", "Room service", "FNB", "FOOD_BEVERAGE"],
  ["2020", "Minibar", "FNB", "MINIBAR"],
  ["2030", "Breakfast", "FNB", "FOOD_BEVERAGE"],
  ["3000", "Laundry", "MISC", "LAUNDRY"],
  ["3010", "Telephone", "MISC", "TELEPHONE"],
  ["3020", "Airport transfer", "MISC", "TRANSPORT"],
  ["3030", "Spa", "MISC", "SPA"],
  ["3090", "Miscellaneous", "MISC", "OTHER"],
] as const;

const PAYMENT_METHODS = [
  ["CASH", "Cash", "CASH", "9000", "Cash", false],
  ["CARD", "Card (hotel terminal)", "CREDIT_CARD", "9100", "Card payment", true],
  ["BANK", "Bank transfer", "BANK_TRANSFER", "9200", "Bank transfer", true],
] as const;

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
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function addDecimal(a: string, b: string): string {
  return formatMoney(parseMoney(a) + parseMoney(b));
}

export async function buildPropertyInventory(db: Db, spec: InventorySpec): Promise<BuiltInventory> {
  const { propertyId } = spec;
  const upsertByCode = <T extends { id: string }>(existing: T | null, create: () => Promise<T>) =>
    existing ? Promise.resolve(existing) : create();

  // Reference codes --------------------------------------------------------------
  const marketGroup = await upsertByCode(
    await db.marketGroup.findFirst({ where: { propertyId, code: "TRN" }, select: { id: true } }),
    () =>
      db.marketGroup.create({
        data: { propertyId, code: "TRN", name: "Transient" },
        select: { id: true },
      }),
  );
  const marketCodes: Record<string, string> = {};
  for (const [code, name] of [
    ["BAR", "Best available rate"],
    ["COR", "Corporate"],
    ["LEI", "Leisure package"],
    ["OTA", "Online travel agency"],
  ] as const) {
    const row = await upsertByCode(
      await db.marketCode.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.marketCode.create({
          data: { propertyId, code, name, marketGroupId: marketGroup.id },
          select: { id: true },
        }),
    );
    marketCodes[code] = row.id;
  }
  const sourceCodes: Record<string, string> = {};
  for (const [code, name] of [
    ["DIR", "Direct"],
    ["PHN", "Telephone"],
    ["WEB", "Hotel website"],
    ["WLK", "Walk-in"],
    ["OTA", "Online travel agency"],
  ] as const) {
    const row = await upsertByCode(
      await db.sourceCode.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () => db.sourceCode.create({ data: { propertyId, code, name }, select: { id: true } }),
    );
    sourceCodes[code] = row.id;
  }
  const channels: Record<string, string> = {};
  for (const [code, name] of [
    ["FD", "Front desk"],
    ["RES", "Reservations office"],
    ["WEB", "Booking engine"],
  ] as const) {
    const row = await upsertByCode(
      await db.channel.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () => db.channel.create({ data: { propertyId, code, name }, select: { id: true } }),
    );
    channels[code] = row.id;
  }
  const reasonCodes: Record<string, string> = {};
  for (const [category, code, name] of [
    ["CANCELLATION", "GUEST", "Cancelled by guest"],
    ["CANCELLATION", "PLANS", "Change of plans"],
    ["CANCELLATION", "DUPL", "Duplicate booking"],
    ["NO_SHOW", "NOSHOW", "Guest did not arrive"],
    ["NO_SHOW", "LATE", "Arrived after release time"],
    ["OUT_OF_ORDER", "MAINT", "Maintenance work"],
    ["OUT_OF_ORDER", "RENO", "Renovation"],
    ["OUT_OF_SERVICE", "TOUCH", "Touch-up / minor repair"],
    ["OUT_OF_SERVICE", "AMEN", "Amenity or furniture missing"],
    ["ROOM_MOVE", "GUEST", "Guest request"],
    ["ROOM_MOVE", "NOISE", "Noise or comfort complaint"],
    ["ROOM_MOVE", "MAINT", "Maintenance issue in room"],
    ["EARLY_DEPARTURE", "PLANS", "Change of plans"],
    ["EARLY_DEPARTURE", "EMERG", "Personal emergency"],
    ["ADJUSTMENT", "RATE", "Rate correction"],
    ["ADJUSTMENT", "SVC", "Service recovery"],
    ["ADJUSTMENT", "ERR", "Posting error"],
    ["VOID", "ERR", "Posted in error"],
    ["VOID", "DUP", "Duplicate posting"],
    ["REFUND", "OVER", "Overpayment"],
    ["REFUND", "GOOD", "Goodwill gesture"],
    ["REFUND", "NSVC", "Service not provided"],
  ] as const) {
    const row = await upsertByCode(
      await db.reasonCode.findFirst({
        where: { propertyId, category, code },
        select: { id: true },
      }),
      () =>
        db.reasonCode.create({ data: { propertyId, category, code, name }, select: { id: true } }),
    );
    reasonCodes[`${category}:${code}`] = row.id;
  }
  const reservationTypes: Record<string, string> = {};
  for (const [code, name, deductsInventory, isGuaranteed] of [
    ["TENT", "Tentative (not deducted)", false, false],
    ["6PM", "6 PM hold", true, false],
    ["GTD", "Guaranteed", true, true],
    ["COMP", "Company guaranteed", true, true],
  ] as const) {
    const row = await upsertByCode(
      await db.reservationType.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.reservationType.create({
          data: {
            propertyId,
            code,
            name,
            deductsInventory,
            isGuaranteed,
            releaseTime: code === "6PM" ? "18:00" : null,
          },
          select: { id: true },
        }),
    );
    reservationTypes[code] = row.id;
  }
  const cancellationPolicies: Record<string, string> = {};
  for (const [code, name, deadlineHours, penaltyType, penaltyValue, description] of [
    [
      "24H",
      "24 hours",
      24,
      "NIGHTS",
      "1",
      "Free cancellation until 24 hours before arrival; then one night is charged.",
    ],
    [
      "72H",
      "72 hours",
      72,
      "NIGHTS",
      "1",
      "Free cancellation until 72 hours before arrival; then one night is charged.",
    ],
    [
      "NRF",
      "Non-refundable",
      0,
      "PERCENT_OF_STAY",
      "100",
      "Non-refundable: the full stay is charged on cancellation.",
    ],
  ] as const) {
    const row = await upsertByCode(
      await db.cancellationPolicy.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.cancellationPolicy.create({
          data: { propertyId, code, name, deadlineHours, penaltyType, penaltyValue, description },
          select: { id: true },
        }),
    );
    cancellationPolicies[code] = row.id;
  }

  // Room charge transaction code ---------------------------------------------------
  const group = await upsertByCode(
    await db.transactionCodeGroup.findFirst({
      where: { propertyId, code: "LODG" },
      select: { id: true },
    }),
    () =>
      db.transactionCodeGroup.create({
        data: { propertyId, code: "LODG", name: "Lodging", type: "REVENUE" },
        select: { id: true },
      }),
  );
  const roomCharge = await upsertByCode(
    await db.transactionCode.findFirst({
      where: { propertyId, code: "1000" },
      select: { id: true },
    }),
    () =>
      db.transactionCode.create({
        data: {
          propertyId,
          groupId: group.id,
          code: "1000",
          name: "Room charge",
          bucket: "ROOM",
          isManualPostAllowed: false,
        },
        select: { id: true },
      }),
  );

  // Billing configuration (Phase 5): codes, taxes, payment methods ------------------
  const chargeCodes: Record<string, string> = { "1000": roomCharge.id };
  const groups: Record<string, string> = {};
  for (const [code, name, type, sortOrder] of CHARGE_GROUPS) {
    const row = await upsertByCode(
      await db.transactionCodeGroup.findFirst({
        where: { propertyId, code },
        select: { id: true },
      }),
      () =>
        db.transactionCodeGroup.create({
          data: { propertyId, code, name, type, sortOrder },
          select: { id: true },
        }),
    );
    groups[code] = row.id;
  }
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
  for (const [code, name, group, bucket] of CHARGE_CODES) {
    await upsertCode(code, { groupId: groups[group]!, name, bucket, isManualPostAllowed: true });
  }
  const paymentMethods: Record<string, string> = {};
  for (const [code, name, kind, txCode, txName, requiresReference] of PAYMENT_METHODS) {
    const transactionCodeId = await upsertCode(txCode, {
      groupId: groups.PAY!,
      name: txName,
      bucket: "PAYMENT",
      isManualPostAllowed: false,
    });
    const row = await upsertByCode(
      await db.paymentMethod.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.paymentMethod.create({
          data: { propertyId, code, name, kind, transactionCodeId, requiresReference },
          select: { id: true },
        }),
    );
    paymentMethods[code] = row.id;
  }
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

  // Housekeeping task types and maintenance categories (Phase 4) ---------------------
  const taskTypes: Record<string, string> = {};
  for (const [code, name, minutes, changesRoomStatus, requiresInspection] of [
    ["DEP", "Departure clean", 45, true, true],
    ["STAY", "Stayover clean", 25, true, false],
    ["DEEP", "Deep clean", 120, true, true],
    ["TURN", "Turndown", 10, false, false],
    ["SPEC", "Special cleaning", 60, true, true],
  ] as const) {
    const row = await upsertByCode(
      await db.housekeepingTaskType.findFirst({
        where: { propertyId, code },
        select: { id: true },
      }),
      () =>
        db.housekeepingTaskType.create({
          data: {
            propertyId,
            code,
            name,
            estimatedMinutes: minutes,
            changesRoomStatus,
            requiresInspection,
          },
          select: { id: true },
        }),
    );
    taskTypes[code] = row.id;
  }
  const maintenanceCategories: Record<string, string> = {};
  for (const [code, name] of [
    ["PLUMB", "Plumbing"],
    ["ELEC", "Electrical"],
    ["HVAC", "Heating and air conditioning"],
    ["FURN", "Furniture and fixtures"],
    ["GEN", "General"],
  ] as const) {
    const row = await upsertByCode(
      await db.maintenanceCategory.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.maintenanceCategory.create({ data: { propertyId, code, name }, select: { id: true } }),
    );
    maintenanceCategories[code] = row.id;
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
  };
}
