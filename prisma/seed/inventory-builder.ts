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

  return {
    roomTypes,
    ratePlans,
    reservationTypes,
    marketCodes,
    sourceCodes,
    channels,
    reasonCodes,
    cancellationPolicies,
  };
}
