/**
 * Demo organization for development (SEED_DEMO=true). Created through the
 * domain services (organization bootstrap, property creation, business-date
 * initialization, reservations) so demo data obeys the same rules as real
 * data. Idempotent: each part is skipped when it already exists.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../lib/auth/password";
import { prisma } from "../../lib/db/prisma";
import type { PropertyContext, SessionContext } from "../../lib/http/context";
import { ALL_PERMISSIONS } from "../../lib/permissions/catalog";
import { bootstrapOrganization } from "../../modules/access/access.service";
import { runInTransaction } from "../../lib/db/transaction";
import {
  lockInventoryForRelease,
  syncInventoryCounters,
} from "../../modules/availability/availability.service";
import {
  addDays,
  fromDateOnly,
  localDateInZone,
  localMidnightUtc,
} from "../../modules/business-date/business-date.policy";
import {
  getCurrentBusinessDate,
  initializeBusinessDate,
} from "../../modules/business-date/business-date.service";
import { guestSearchName } from "../../modules/guests/guests.policy";
import { ensureGuestFolioInTx } from "../../modules/billing/billing.service";
import { checkIn } from "../../modules/front-desk/front-desk.service";
import { assignTask, queueCleaningInTx } from "../../modules/housekeeping/housekeeping.service";
import { createRequest } from "../../modules/maintenance/maintenance.service";
import { createBlock, createGroup } from "../../modules/groups/groups.service";
import { createProperty } from "../../modules/properties/properties.service";
import { stayNights } from "../../modules/reservations/reservations.policy";
import type { CreateReservationInput } from "../../modules/reservations/reservations.schema";
import {
  cancelReservation,
  createReservation,
  listAvailableRooms,
} from "../../modules/reservations/reservations.service";
import { type InventorySpec, buildPropertyInventory } from "./inventory-builder";

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

const ROOM_TYPES: Record<string, InventorySpec["roomTypes"]> = {
  SMR: [
    {
      code: "STD",
      name: "Standard Mountain View",
      rooms: 18,
      maxOccupancy: 3,
      maxAdults: 3,
      maxChildren: 2,
      oneAdult: "16000",
      twoAdults: "18500",
      extraAdult: "4000",
      extraChild: "2000",
      weekendUplift: "3500",
    },
    {
      code: "DLX",
      name: "Deluxe Valley View",
      rooms: 10,
      maxOccupancy: 3,
      maxAdults: 3,
      maxChildren: 2,
      oneAdult: "24000",
      twoAdults: "27000",
      extraAdult: "5000",
      extraChild: "2500",
      weekendUplift: "5000",
    },
    {
      code: "STE",
      name: "Pine Suite",
      rooms: 4,
      maxOccupancy: 4,
      maxAdults: 4,
      maxChildren: 2,
      oneAdult: "42000",
      twoAdults: "45000",
      extraAdult: "6000",
      extraChild: "3000",
      weekendUplift: "8000",
    },
  ],
  SDX: [
    {
      code: "KNG",
      name: "King Room",
      rooms: 14,
      maxOccupancy: 2,
      maxAdults: 2,
      maxChildren: 1,
      oneAdult: "620",
      twoAdults: "680",
      extraChild: "90",
      weekendUplift: "120",
    },
    {
      code: "TWN",
      name: "Twin Room",
      rooms: 12,
      maxOccupancy: 3,
      maxAdults: 3,
      maxChildren: 1,
      oneAdult: "600",
      twoAdults: "660",
      extraAdult: "150",
      extraChild: "90",
      weekendUplift: "110",
    },
    {
      code: "EXS",
      name: "Executive Suite",
      rooms: 3,
      maxOccupancy: 4,
      maxAdults: 4,
      maxChildren: 2,
      oneAdult: "1350",
      twoAdults: "1450",
      extraAdult: "200",
      extraChild: "120",
      weekendUplift: "250",
    },
  ],
};

/**
 * Demo tax configuration (Phase 5), stored as tax rules in the database.
 * SMR: 16% sales tax on rooms, food & beverage and spa. SDX: 10% service
 * charge and 7% municipality fee, 5% VAT compounded on top of both, and a
 * flat tourism fee per room night (after VAT, so not taxed itself).
 */
const ROOM_AND_OUTLETS = ["1000", "2000", "2010", "2020", "2030", "3030"];
const TAXES: Record<string, InventorySpec["taxes"]> = {
  SMR: [
    {
      code: "GST",
      name: "Sales tax 16%",
      calculation: "PERCENT",
      basis: "NET",
      rate: "16",
      sequence: 1,
      appliesTo: [...ROOM_AND_OUTLETS, "3000"],
    },
  ],
  SDX: [
    {
      code: "SVC",
      name: "Service charge 10%",
      calculation: "PERCENT",
      basis: "NET",
      rate: "10",
      sequence: 1,
      bucket: "SERVICE_CHARGE",
      appliesTo: ROOM_AND_OUTLETS,
    },
    {
      code: "MUNI",
      name: "Municipality fee 7%",
      calculation: "PERCENT",
      basis: "NET",
      rate: "7",
      sequence: 2,
      appliesTo: ROOM_AND_OUTLETS,
    },
    {
      code: "VAT",
      name: "VAT 5%",
      calculation: "PERCENT",
      basis: "COMPOUND",
      rate: "5",
      sequence: 3,
      appliesTo: [...ROOM_AND_OUTLETS, "3000", "3010", "3020", "3090"],
    },
    {
      code: "TDIR",
      name: "Tourism dirham",
      calculation: "FLAT_PER_UNIT",
      basis: "NET",
      rate: "15",
      sequence: 4,
      appliesTo: ["1000"],
    },
  ],
};

/** [email local part, display name, role code, scope: "ORG" or property codes] */
const USERS: [string, string, string, "ORG" | readonly string[]][] = [
  ["admin", "Organization Admin", "ORGANIZATION_ADMIN", "ORG"],
  ["gm.smr", "Ayesha Khan (GM, Mountain Resort)", "GENERAL_MANAGER", ["SMR"]],
  ["fom.smr", "Bilal Ahmed (Front Office Manager)", "FRONT_OFFICE_MANAGER", ["SMR"]],
  ["agent.smr", "Sara Malik (Front Desk)", "FRONT_DESK_AGENT", ["SMR"]],
  ["hk.smr", "Imran Ali (Housekeeping)", "HOUSEKEEPER", ["SMR"]],
  ["hksup.smr", "Farah Jamil (Housekeeping Supervisor)", "HOUSEKEEPING_MANAGER", ["SMR"]],
  ["maint.smr", "Kashif Mehmood (Maintenance)", "MAINTENANCE_STAFF", ["SMR"]],
  ["chief.smr", "Tariq Aziz (Chief Engineer)", "MAINTENANCE_MANAGER", ["SMR"]],
  ["gm.sdx", "Omar Haddad (GM, City Hotel)", "GENERAL_MANAGER", ["SDX"]],
  ["auditor", "Nadia Rahman (Auditor, both hotels)", "AUDITOR", ["SMR", "SDX"]],
];

const GUESTS: [string, string, string, string | null, string | null][] = [
  ["Mr", "Hamza", "Qureshi", "PK", "hamza.qureshi@example.com"],
  ["Ms", "Mahnoor", "Siddiqui", "PK", "mahnoor.s@example.com"],
  ["Mr", "Daniyal", "Farooq", "PK", null],
  ["Mrs", "Fatima", "Zaidi", "PK", "fzaidi@example.com"],
  ["Mr", "Ahmed", "Al Mansoori", "AE", "ahmed.almansoori@example.com"],
  ["Ms", "Layla", "Haddad", "JO", "layla.h@example.com"],
  ["Mr", "James", "Whitfield", "GB", "j.whitfield@example.com"],
  ["Dr", "Sofia", "Rossi", "IT", "sofia.rossi@example.com"],
  ["Mr", "Kenji", "Tanaka", "JP", null],
  ["Ms", "Aisha", "Rahman", "BD", "aisha.rahman@example.com"],
];

export async function seedDemo(): Promise<void> {
  const organization = await ensureOrganization();

  for (const spec of PROPERTIES) {
    const property = await prisma.property.findFirst({
      where: { organizationId: organization.id, code: spec.code },
      select: { id: true, code: true, timezone: true, currencyCode: true },
    });
    if (!property) continue;
    const businessDate = await getCurrentBusinessDate(property.id);
    if (!businessDate) continue;

    const inventory = await buildPropertyInventory(prisma, {
      propertyId: property.id,
      currencyCode: property.currencyCode,
      seasonStart: addDays(businessDate, -30),
      seasonEnd: addDays(businessDate, 730),
      roomTypes: ROOM_TYPES[spec.code]!,
      taxes: TAXES[spec.code]!,
      breakfastPrice: spec.code === "SDX" ? "75" : "1800",
    });
    const ctx: PropertyContext = {
      ...organization.adminCtx,
      access: { ...organization.adminCtx.access, byProperty: { [property.id]: ALL_PERMISSIONS } },
      propertyId: property.id,
      propertyCode: property.code,
      timezone: property.timezone,
      currencyCode: property.currencyCode,
      businessDate,
    };
    await seedPropertyReservations(ctx, organization.id, businessDate, inventory);
    await seedOperations(ctx, businessDate, inventory);
    await seedFolios(ctx, businessDate);
    await seedGroups(ctx, businessDate, inventory);
    console.warn(`Seeded inventory and sample reservations for ${spec.code}.`);
  }
}

async function seedPropertyReservations(
  ctx: PropertyContext,
  organizationId: string,
  businessDate: string,
  inventory: Awaited<ReturnType<typeof buildPropertyInventory>>,
) {
  const guestIds: string[] = [];
  for (const [title, firstName, lastName, nationalityCode, email] of GUESTS) {
    const existing = await prisma.guest.findFirst({
      where: { organizationId, firstName, lastName },
      select: { id: true },
    });
    const guest =
      existing ??
      (await prisma.guest.create({
        data: {
          organizationId,
          profileNumber: `G${randomBytes(4).toString("hex").toUpperCase().slice(0, 7)}`,
          title,
          firstName,
          lastName,
          searchName: guestSearchName(firstName, lastName),
          nationalityCode,
          primaryEmail: email,
        },
        select: { id: true },
      }));
    guestIds.push(guest.id);
  }

  const [firstType, secondType, thirdType] = Object.values(inventory.roomTypes);
  /** Each sample booking carries a DEMO-nn reference so reruns only add what is missing. */
  const book = async (
    reference: string,
    offset: number,
    nights: number,
    guest: number,
    roomTypeId: string,
    extra: Partial<CreateReservationInput> = {},
  ) => {
    const exists = await prisma.reservation.findFirst({
      where: { propertyId: ctx.propertyId, externalReference: reference },
      select: { id: true },
    });
    if (exists) return null;
    return createReservation(ctx, {
      arrival: addDays(businessDate, offset),
      departure: addDays(businessDate, offset + nights),
      adults: 2,
      children: 0,
      rooms: 1,
      roomTypeId,
      ratePlanId: inventory.ratePlans.BAR!,
      reservationTypeId: inventory.reservationTypes.GTD!,
      guestId: guestIds[guest % guestIds.length]!,
      channelId: inventory.channels.RES,
      specialRequests: undefined,
      externalReference: reference,
      waitlist: false,
      override: false,
      ...extra,
    });
  };

  await book("DEMO-01", 0, 2, 0, firstType!.id, {
    roomId: firstType!.roomIds[1],
    specialRequests: "Late arrival around 22:00.",
  });
  await book("DEMO-02", 0, 3, 1, secondType!.id);
  await book("DEMO-03", 1, 4, 2, firstType!.id, { adults: 1, children: 1 });
  await book("DEMO-04", 3, 2, 3, thirdType!.id, {
    specialRequests: "Anniversary: flowers in room.",
  });
  await book("DEMO-05", 5, 5, 4, secondType!.id, { rooms: 2 });
  await book("DEMO-06", 7, 3, 5, firstType!.id, {
    reservationTypeId: inventory.reservationTypes.TENT!,
  });
  await book("DEMO-07", 10, 2, 6, thirdType!.id, { waitlist: true });
  const toCancel = await book("DEMO-08", 12, 3, 7, firstType!.id);
  if (toCancel) {
    await cancelReservation(ctx, toCancel.rooms[0]!.id, {
      version: toCancel.rooms[0]!.version,
      reasonCodeId: inventory.reasonCodes["CANCELLATION:PLANS"]!,
      reason: "Guest changed travel plans (demo data)",
    });
  }
  await book("DEMO-09", 14, 1, 8, secondType!.id, { adults: 1 });
  await book("DEMO-10", 20, 6, 9, firstType!.id, { ratePlanId: inventory.ratePlans.ADV! });

  if ((await prisma.roomServiceBlock.count({ where: { propertyId: ctx.propertyId } })) === 0) {
    // One room out of order for a few nights, so availability reflects it.
    await prisma.roomServiceBlock.create({
      data: {
        propertyId: ctx.propertyId,
        roomId: secondType!.roomIds.at(-1)!,
        kind: "OUT_OF_ORDER",
        status: "SCHEDULED",
        fromDate: new Date(`${addDays(businessDate, 2)}T00:00:00.000Z`),
        toDate: new Date(`${addDays(businessDate, 6)}T00:00:00.000Z`),
        reasonCodeId: inventory.reasonCodes["OUT_OF_ORDER:MAINT"]!,
        notes: "Bathroom refit (demo data)",
        createdById: ctx.userId,
      },
    });
  }

  await seedFrontDesk(ctx, businessDate, inventory, guestIds, book);
}

type Inventory = Awaited<ReturnType<typeof buildPropertyInventory>>;
type ReadyRoom = (
  roomTypeId: string,
  arrival: string,
  departure: string,
) => Promise<{ id: string } | undefined>;

/**
 * Front desk sample data (Phase 3): arrivals to check in, guests in house
 * and guests due out on the business date.
 */
async function seedFrontDesk(
  ctx: PropertyContext,
  businessDate: string,
  inventory: Inventory,
  guestIds: string[],
  book: (
    reference: string,
    offset: number,
    nights: number,
    guest: number,
    roomTypeId: string,
    extra?: Partial<CreateReservationInput>,
  ) => Promise<unknown>,
) {
  const [firstType, secondType] = Object.values(inventory.roomTypes);
  const readyRoom: ReadyRoom = async (roomTypeId, arrival, departure) => {
    const rooms = await listAvailableRooms(ctx, { roomTypeId, arrival, departure });
    return rooms.find(
      (room) =>
        room.frontOfficeStatus === "VACANT" &&
        (room.housekeepingStatus === "CLEAN" || room.housekeepingStatus === "INSPECTED"),
    );
  };

  // Due in today with a ready room, and due in today still tentative.
  if (!(await referenceExists(ctx, "DEMO-11"))) {
    const room = await readyRoom(firstType!.id, businessDate, addDays(businessDate, 3));
    await book("DEMO-11", 0, 3, 2, firstType!.id, room ? { roomId: room.id } : {});
  }
  await book("DEMO-12", 0, 1, 3, secondType!.id, {
    reservationTypeId: inventory.reservationTypes.TENT!,
    adults: 1,
  });

  // In house: one arrived today (checked in through the service) and guests
  // who arrived before the demo's business date, two of them due out today.
  const stays: [string, number, string, number, number][] = [
    ["DEMO-13", 4, secondType!.id, 0, 2],
    ["DEMO-14", 5, firstType!.id, 2, 0],
    ["DEMO-15", 6, secondType!.id, 3, 0],
    ["DEMO-16", 7, firstType!.id, 1, 2],
  ];
  for (const [reference, guest, roomTypeId, before, after] of stays) {
    await seedStay(ctx, businessDate, inventory, readyRoom, {
      reference,
      guestId: guestIds[guest % guestIds.length]!,
      roomTypeId,
      nightsBefore: before,
      nightsAfter: after,
    });
  }
}

async function referenceExists(ctx: PropertyContext, reference: string) {
  const row = await prisma.reservation.findFirst({
    where: { propertyId: ctx.propertyId, externalReference: reference },
    select: { id: true },
  });
  return row !== null;
}

/**
 * A checked-in guest. The booking and the check-in go through the services
 * on the business date. For a guest who arrived `nightsBefore` nights
 * earlier, the stay is then moved back in time (reservation dates, nights,
 * assignment, stay arrival): the demo has no night-audit history that would
 * have produced it naturally.
 */
async function seedStay(
  ctx: PropertyContext,
  businessDate: string,
  inventory: Inventory,
  readyRoom: ReadyRoom,
  spec: {
    reference: string;
    guestId: string;
    roomTypeId: string;
    nightsBefore: number;
    nightsAfter: number;
  },
) {
  if (await referenceExists(ctx, spec.reference)) return;
  const arrival = addDays(businessDate, -spec.nightsBefore);
  const departure = addDays(businessDate, spec.nightsAfter);
  const bookedDeparture = addDays(businessDate, Math.max(spec.nightsAfter, 1));
  const room = await readyRoom(spec.roomTypeId, arrival, bookedDeparture);
  if (!room) return;

  const created = await createReservation(ctx, {
    arrival: businessDate,
    departure: bookedDeparture,
    adults: 2,
    children: 0,
    rooms: 1,
    roomTypeId: spec.roomTypeId,
    roomId: room.id,
    ratePlanId: inventory.ratePlans.BAR!,
    reservationTypeId: inventory.reservationTypes.GTD!,
    guestId: spec.guestId,
    channelId: inventory.channels.FD,
    specialRequests: undefined,
    externalReference: spec.reference,
    waitlist: false,
    override: false,
  });
  const line = created.rooms[0]!;
  await checkIn(ctx, line.id, { version: line.version, acceptNotReady: false });
  if (spec.nightsBefore === 0 && departure === bookedDeparture) return;

  await runInTransaction(async (tx) => {
    const demand = {
      roomTypeId: spec.roomTypeId,
      arrival,
      departure: bookedDeparture,
      rooms: 1,
    };
    await lockInventoryForRelease(tx, ctx.propertyId, [demand]);
    const night = await tx.reservationRoomNight.findFirstOrThrow({
      where: { reservationRoomId: line.id },
      select: { roomTypeId: true, ratePlanId: true, rateAmount: true, currencyCode: true },
    });
    await tx.reservationRoomNight.deleteMany({ where: { reservationRoomId: line.id } });
    await tx.reservationRoomNight.createMany({
      data: stayNights(arrival, departure).map((date) => ({
        propertyId: ctx.propertyId,
        reservationRoomId: line.id,
        stayDate: fromDateOnly(date),
        roomTypeId: night.roomTypeId,
        ratePlanId: night.ratePlanId,
        rateAmount: night.rateAmount,
        currencyCode: night.currencyCode,
        adults: 2,
        children: 0,
      })),
    });
    await tx.reservationRoom.update({
      where: { id: line.id },
      data: { arrivalDate: fromDateOnly(arrival), departureDate: fromDateOnly(departure) },
    });
    await tx.roomAssignment.updateMany({
      where: { reservationRoomId: line.id, status: "ACTIVE" },
      data: { fromDate: fromDateOnly(arrival), toDate: fromDateOnly(departure) },
    });
    const checkedInAt = new Date(
      localMidnightUtc(arrival, ctx.timezone).getTime() + 15 * 3_600_000,
    );
    await tx.stay.updateMany({
      where: { reservationRoomId: line.id },
      data: { arrivalBusinessDate: fromDateOnly(arrival), checkedInAt },
    });
    await syncInventoryCounters(tx, ctx.propertyId, [demand]);
  });
}

async function ensureOrganization(): Promise<{ id: string; adminCtx: SessionContext }> {
  const existing = await prisma.organization.findUnique({
    where: { code: ORG_CODE },
    select: { id: true },
  });
  if (existing) {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@serene.test" },
      select: { id: true, passwordHash: true },
    });
    await ensureDemoUsers(existing.id, admin);
    return { id: existing.id, adminCtx: systemContext(existing.id, admin.id) };
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
  const adminCtx = systemContext(organization.id, admin.id);

  const propertyIds: Record<string, string> = {};
  for (const spec of PROPERTIES) {
    const property = await createProperty(adminCtx, {
      ...spec,
      checkInTime: "14:00",
      checkOutTime: "12:00",
      reason: "Demo data seed",
    });
    propertyIds[spec.code] = property.id;
    await initializeBusinessDate(
      {
        ...adminCtx,
        propertyId: property.id,
        propertyCode: property.code,
        timezone: property.timezone,
        currencyCode: property.currencyCode,
        businessDate: null,
      },
      { date: localDateInZone(new Date(), property.timezone), reason: "Demo data seed: go-live" },
    );
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
  return { id: organization.id, adminCtx };
}

/**
 * Demo users added in later phases, for an organization seeded earlier. They
 * share the existing demo password (the admin's hash), like all demo users.
 */
async function ensureDemoUsers(
  organizationId: string,
  admin: { id: string; passwordHash: string | null },
) {
  const roles = await prisma.role.findMany({
    where: { organizationId: null, isSystem: true },
    select: { id: true, code: true },
  });
  const properties = await prisma.property.findMany({
    where: { organizationId },
    select: { id: true, code: true },
  });
  for (const [local, displayName, role, scope] of USERS.slice(1)) {
    const email = `${local}@serene.test`;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) continue;
    const roleRow = roles.find((r) => r.code === role);
    if (!roleRow || scope === "ORG" || !admin.passwordHash) continue;
    const propertyIds = scope
      .map((code) => properties.find((p) => p.code === code)?.id)
      .filter((id): id is string => !!id);
    const user = await prisma.user.create({
      data: {
        organizationId,
        email,
        displayName,
        passwordHash: admin.passwordHash,
        passwordChangedAt: new Date(),
        status: "ACTIVE",
        defaultPropertyId: propertyIds[0] ?? null,
      },
      select: { id: true },
    });
    await prisma.userRoleAssignment.createMany({
      data: propertyIds.map((propertyId) => ({
        userId: user.id,
        roleId: roleRow.id,
        scope: "PROPERTY" as const,
        propertyId,
        grantedById: admin.id,
      })),
    });
    console.warn(`Added demo user ${email} (existing demo password).`);
  }
}

/** The seed acts as the organization admin; audit records attribute to it. */
function systemContext(organizationId: string, adminId: string): SessionContext {
  return {
    requestId: "seed-demo",
    ipAddress: null,
    userAgent: "prisma-seed",
    userId: adminId,
    organizationId,
    sessionId: "seed",
    access: {
      userId: adminId,
      organizationId,
      isSuperAdmin: false,
      organizationPermissions: ALL_PERMISSIONS,
      byProperty: {},
    },
  };
}

function roleId(roleIdsByCode: Record<string, string>, code: string): string {
  const id = roleIdsByCode[code];
  if (!id) throw new Error(`Role template ${code} is missing`);
  return id;
}

/**
 * Housekeeping and maintenance sample data (Phase 4). SMR only gives guests
 * inspected rooms: when that rule is switched on, rooms that are vacant and
 * clean at that moment are recorded as inspected once, so the demo keeps
 * ready rooms. Every vacant dirty room gets a cleaning task; the first two
 * go to the demo housekeeper. One open maintenance request.
 */
async function seedOperations(ctx: PropertyContext, businessDate: string, inventory: Inventory) {
  if (ctx.propertyCode === "SMR") {
    const configuration = await prisma.propertyConfiguration.findUnique({
      where: { propertyId: ctx.propertyId },
      select: { requireInspectedForCheckIn: true },
    });
    if (!configuration?.requireInspectedForCheckIn) {
      await prisma.propertyConfiguration.upsert({
        where: { propertyId: ctx.propertyId },
        update: { requireInspectedForCheckIn: true },
        create: { propertyId: ctx.propertyId, requireInspectedForCheckIn: true },
      });
      await prisma.room.updateMany({
        where: {
          propertyId: ctx.propertyId,
          housekeepingStatus: "CLEAN",
          frontOfficeStatus: "VACANT",
        },
        data: { housekeepingStatus: "INSPECTED" },
      });
    }
  }

  const dirtyRooms = await prisma.room.findMany({
    where: {
      propertyId: ctx.propertyId,
      status: "ACTIVE",
      frontOfficeStatus: "VACANT",
      housekeepingStatus: { in: ["DIRTY", "PICKUP"] },
    },
    orderBy: { number: "asc" },
    select: { id: true },
  });
  for (const room of dirtyRooms) {
    await runInTransaction((tx) =>
      queueCleaningInTx(tx, ctx, businessDate, {
        roomId: room.id,
        note: "Demo: vacant dirty room",
      }),
    );
  }

  const housekeeper = await prisma.user.findUnique({
    where: { email: `hk.${ctx.propertyCode.toLowerCase()}@serene.test` },
    select: { id: true },
  });
  if (housekeeper) {
    const unassigned = await prisma.housekeepingTask.findMany({
      where: { propertyId: ctx.propertyId, status: "PENDING", attendantId: null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: 2,
      select: { id: true, version: true },
    });
    const alreadyAssigned = await prisma.housekeepingTask.count({
      where: { propertyId: ctx.propertyId, attendant: { userId: housekeeper.id } },
    });
    if (alreadyAssigned === 0) {
      for (const task of unassigned) {
        await assignTask(ctx, task.id, { version: task.version, assigneeId: housekeeper.id });
      }
    }
  }

  if ((await prisma.maintenanceRequest.count({ where: { propertyId: ctx.propertyId } })) === 0) {
    const [firstType] = Object.values(inventory.roomTypes);
    await createRequest(ctx, {
      roomId: firstType!.roomIds.at(-2),
      categoryId: inventory.maintenanceCategories.HVAC!,
      title: "Air conditioner rattles at night",
      description: "Reported by the guest in the last stay (demo data).",
      priority: "NORMAL",
    });
  }
}

/**
 * Billing (Phase 5): check-in opens window 1; stays checked in before
 * folios existed get theirs here, through the same service.
 */
async function seedFolios(ctx: PropertyContext, businessDate: string) {
  const rooms = await prisma.reservationRoom.findMany({
    where: { propertyId: ctx.propertyId, status: "IN_HOUSE", folios: { none: {} } },
    select: { id: true, primaryGuestId: true },
  });
  for (const room of rooms) {
    await runInTransaction((tx) => ensureGuestFolioInTx(tx, ctx, businessDate, room, 1));
  }
}

/**
 * Groups (Phase 6): one group with a definite block a week out, created
 * through the group service so it holds inventory like any other block.
 */
async function seedGroups(ctx: PropertyContext, businessDate: string, inventory: Inventory) {
  const code = `${ctx.propertyCode}-RETREAT`;
  if (await prisma.group.findFirst({ where: { code }, select: { id: true } })) return;
  const group = await createGroup(ctx, {
    code,
    name: ctx.propertyCode === "SDX" ? "Gulf Tech Summit delegates" : "Acme leadership retreat",
    notes: "Demo group: definite block at the group rate.",
  });
  const [firstType] = Object.values(inventory.roomTypes);
  await createBlock(ctx, group.id, {
    code: `${ctx.propertyCode}-R1`,
    name: "Main block",
    statusId: inventory.blockStatuses.DEF!,
    startDate: addDays(businessDate, 7),
    endDate: addDays(businessDate, 10),
    ratePlanId: inventory.ratePlans.GRP!,
    allocations: [{ roomTypeId: firstType!.id, rooms: 5 }],
    isElastic: false,
    override: false,
  });
}
