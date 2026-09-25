import { beforeAll, describe, expect, it } from "vitest";
import { GET as arrivalsRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/arrivals/route";
import { GET as departuresRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/departures/route";
import { GET as inHouseRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/in-house/route";
import { GET as roomBoardRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/rooms/route";
import { GET as summaryRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/summary/route";
import { POST as walkInRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/walk-ins/route";
import { POST as assignRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/assign-room/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { GET as roomOptionsRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/room-options/route";
import { GET as detailRoute } from "@/app/api/v1/properties/[propertyId]/reservations/[reservationId]/route";
import { POST as createRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as checkOutRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/check-out/route";
import { POST as moveRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/room-move/route";
import { GET as stayRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/route";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import { stayNights } from "@/modules/reservations/reservations.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let A: string;
let B: string;
let invA: Inventory;
let invB: Inventory;
let D: string; // business date of property A
let fom: CookieJar; // front office manager @ A (can override availability)
let agent: CookieJar; // front desk agent @ A
let resAgent: CookieJar; // reservations agent @ A (no front desk commands)
let housekeeper: CookieJar;
let gmB: CookieJar;
let guestId: string;

/** Rooms of A handed out one at a time so every test uses its own rooms. */
const pool: Record<string, string[]> = {};
function takeRoom(type: "KNG" | "TWN" | "SGL"): string {
  const room = pool[type]!.shift();
  if (!room) throw new Error(`Fixture ran out of ${type} rooms`);
  return room;
}

const base = (propertyId: string) => `/api/v1/properties/${propertyId}`;

async function book(overrides: Record<string, unknown> = {}, jar = fom, propertyId = A) {
  const inv = propertyId === A ? invA : invB;
  const r = await call(createRoute, {
    method: "POST",
    path: `${base(propertyId)}/reservations`,
    params: { propertyId },
    body: {
      arrival: D,
      departure: addDays(D, 2),
      adults: 2,
      children: 0,
      rooms: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
      ...overrides,
    },
    jar,
  });
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  return r.body.data.rooms[0] as { id: string; version: number; reservationId?: string } & {
    [k: string]: unknown;
  };
}

function checkIn(
  jar: CookieJar,
  reservationRoomId: string,
  body: Record<string, unknown>,
  propertyId = A,
) {
  return call(checkInRoute, {
    method: "POST",
    path: `${base(propertyId)}/reservation-rooms/${reservationRoomId}/check-in`,
    params: { propertyId, reservationRoomId },
    body,
    jar,
  });
}

function stayCommand(
  route: typeof moveRoute,
  action: string,
  jar: CookieJar,
  stayId: string,
  body: Record<string, unknown>,
  propertyId = A,
) {
  return call(route, {
    method: "POST",
    path: `${base(propertyId)}/stays/${stayId}/${action}`,
    params: { propertyId, stayId },
    body,
    jar,
  });
}

const move = (jar: CookieJar, stayId: string, body: Record<string, unknown>, propertyId = A) =>
  stayCommand(moveRoute, "room-move", jar, stayId, body, propertyId);
const checkOut = (jar: CookieJar, stayId: string, body: Record<string, unknown>, propertyId = A) =>
  stayCommand(checkOutRoute, "check-out", jar, stayId, body, propertyId);

function getStay(jar: CookieJar, stayId: string, propertyId = A) {
  return call(stayRoute, {
    path: `${base(propertyId)}/stays/${stayId}`,
    params: { propertyId, stayId },
    jar,
  });
}

function list(route: typeof arrivalsRoute, path: string, jar = agent, query = "", propertyId = A) {
  return call(route, {
    path: `${base(propertyId)}/front-desk/${path}${query ? `?${query}` : ""}`,
    params: { propertyId },
    jar,
  });
}

/** Books an arrival for today with a specific room and checks it in. */
async function inHouse(type: "KNG" | "TWN" | "SGL" = "KNG", nights = 2) {
  const roomId = takeRoom(type);
  const rr = await book({
    roomTypeId: invA.roomTypes[type]!.id,
    departure: addDays(D, nights),
    roomId,
    adults: 1,
  });
  const r = await checkIn(agent, rr.id, { version: rr.version });
  if (r.status !== 201) throw new Error(`Check-in failed: ${JSON.stringify(r.body)}`);
  return { reservationRoomId: rr.id, roomId, stay: r.body.data };
}

/**
 * Moves a checked-in stay back in time to [D - nightsBefore, D + nightsAfter)
 * (the fixture has no night-audit history), mirroring the demo seed; the
 * nights before D count as posted by those earlier audits.
 */
async function backdate(reservationRoomId: string, nightsBefore: number, nightsAfter: number) {
  const arrival = addDays(D, -nightsBefore);
  const departure = addDays(D, nightsAfter);
  const night = await prisma.reservationRoomNight.findFirstOrThrow({
    where: { reservationRoomId },
    select: { roomTypeId: true, ratePlanId: true, rateAmount: true, currencyCode: true },
  });
  await prisma.$transaction([
    prisma.reservationRoomNight.deleteMany({ where: { reservationRoomId } }),
    prisma.reservationRoomNight.createMany({
      data: stayNights(arrival, departure).map((date) => ({
        propertyId: A,
        reservationRoomId,
        stayDate: fromDateOnly(date),
        ...night,
        adults: 1,
        children: 0,
        // Nights before today were posted by earlier night audits (Phase 8).
        postedAt: date < D ? new Date() : null,
      })),
    }),
    prisma.reservationRoom.update({
      where: { id: reservationRoomId },
      data: { arrivalDate: fromDateOnly(arrival), departureDate: fromDateOnly(departure) },
    }),
    prisma.roomAssignment.updateMany({
      where: { reservationRoomId, status: "ACTIVE" },
      data: { fromDate: fromDateOnly(arrival), toDate: fromDateOnly(departure) },
    }),
    prisma.stay.updateMany({
      where: { reservationRoomId },
      data: { arrivalBusinessDate: fromDateOnly(arrival) },
    }),
  ]);
}

function roomState(roomId: string) {
  return prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { frontOfficeStatus: true, housekeepingStatus: true },
  });
}

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  invA = await buildFixtureInventory(org, "A", [
    { code: "KNG", rooms: 60 },
    { code: "TWN", rooms: 2 },
    { code: "SGL", rooms: 1, maxOccupancy: 1 },
  ]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 3 }]);
  D = invA.businessDate;
  // Deterministic starting point: every room clean and vacant.
  await prisma.room.updateMany({
    where: { propertyId: { in: [A, B] } },
    data: { housekeepingStatus: "CLEAN", frontOfficeStatus: "VACANT" },
  });
  for (const type of ["KNG", "TWN", "SGL"] as const)
    pool[type] = [...invA.roomTypes[type]!.roomIds];
  guestId = (await createGuestRow(org, "Layla", "Haddad")).id;

  const fomUser = await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]);
  const agentUser = await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
  const resUser = await createUser(org, "res", [{ role: "RESERVATIONS_AGENT", property: "A" }]);
  const hkUser = await createUser(org, "hk", [{ role: "HOUSEKEEPER", property: "A" }]);
  const gmBUser = await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]);
  fom = await loginAs(fomUser.email, TEST_PASSWORD);
  agent = await loginAs(agentUser.email, TEST_PASSWORD);
  resAgent = await loginAs(resUser.email, TEST_PASSWORD);
  housekeeper = await loginAs(hkUser.email, TEST_PASSWORD);
  gmB = await loginAs(gmBUser.email, TEST_PASSWORD);
}, 180_000);

describe("check-in", () => {
  it("checks in an arrival with an assigned room: stay, reservation, room and audit change together", async () => {
    const roomId = takeRoom("KNG");
    const rr = await book({ roomId });
    const r = await checkIn(agent, rr.id, { version: rr.version });
    expect(r.status).toBe(201);
    const stay = r.body.data;
    expect(stay).toMatchObject({
      status: "IN_HOUSE",
      arrivalBusinessDate: D,
      room: { id: roomId, frontOfficeStatus: "OCCUPIED" },
      checkoutTiming: "SAME_DAY",
      allowedActions: { checkOut: false, moveRoom: true },
    });

    const row = await prisma.stay.findUniqueOrThrow({ where: { id: stay.id } });
    expect(row).toMatchObject({ status: "IN_HOUSE", roomId, propertyId: A });
    expect(row.arrivalBusinessDate.toISOString().slice(0, 10)).toBe(D);
    const reservationRoom = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: rr.id },
    });
    expect(reservationRoom).toMatchObject({ status: "IN_HOUSE", roomId, version: rr.version + 1 });
    expect(await roomState(roomId)).toEqual({
      frontOfficeStatus: "OCCUPIED",
      housekeepingStatus: "CLEAN",
    });
    const history = await prisma.roomStatusHistory.findMany({ where: { roomId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      field: "FRONT_OFFICE",
      fromValue: "VACANT",
      toValue: "OCCUPIED",
      source: "CHECK_IN",
    });
    expect(history[0]!.businessDate.toISOString().slice(0, 10)).toBe(D);

    const [audit] = await auditLogsFor(stay.id);
    expect(audit).toMatchObject({ action: "stay.check_in", risk: "STANDARD", propertyId: A });
    expect(audit!.businessDate!.toISOString().slice(0, 10)).toBe(D);
    expect(audit!.before).toMatchObject({ reservationStatus: "RESERVED" });
    expect(audit!.after).toMatchObject({ reservationStatus: "IN_HOUSE", roomAssigned: false });
  });

  it("assigns the room as part of the check-in when none was assigned", async () => {
    const rr = await book();
    const roomId = takeRoom("KNG");
    const r = await checkIn(agent, rr.id, { version: rr.version, roomId });
    expect(r.status).toBe(201);
    const assignments = await prisma.roomAssignment.findMany({
      where: { reservationRoomId: rr.id },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ roomId, status: "ACTIVE", kind: "INITIAL" });
    const [audit] = await auditLogsFor(r.body.data.id);
    expect(audit!.after).toMatchObject({ roomAssigned: true });
  });

  it("requires a room", async () => {
    const rr = await book();
    const r = await checkIn(agent, rr.id, { version: rr.version });
    expect(r.status).toBe(422);
    expect(r.body.error.details.reason).toBe("ROOM_REQUIRED");
    expect((await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe(
      "RESERVED",
    );
  });

  it("rejects invalid reservation states and future arrivals using the business date", async () => {
    const future = await book({ arrival: addDays(D, 1), departure: addDays(D, 3) });
    const r1 = await checkIn(agent, future.id, {
      version: future.version,
      roomId: takeRoom("KNG"),
    });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe("INVALID_STATE_TRANSITION");

    const tentative = await book({ reservationTypeId: invA.reservationTypes.TENT! });
    const r2 = await checkIn(agent, tentative.id, {
      version: tentative.version,
      roomId: takeRoom("KNG"),
    });
    expect(r2.status).toBe(422);
    expect(r2.body.error.message).toMatch(/Confirm the reservation/);
    expect(await prisma.stay.count({ where: { reservationRoomId: tentative.id } })).toBe(0);
  });

  it("refuses a duplicate check-in: stale version (409) or already in house (422)", async () => {
    const roomId = takeRoom("KNG");
    const rr = await book({ roomId });
    expect((await checkIn(agent, rr.id, { version: rr.version })).status).toBe(201);
    const again = await checkIn(agent, rr.id, { version: rr.version });
    expect(again.status).toBe(409);
    const fresh = await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr.id } });
    const third = await checkIn(agent, rr.id, { version: fresh.version });
    expect(third.status).toBe(422);
    expect(third.body.error.code).toBe("INVALID_STATE_TRANSITION");
    expect(await prisma.stay.count({ where: { reservationRoomId: rr.id } })).toBe(1);
  });

  it("denies users without frontdesk:checkin and leaves the reservation untouched", async () => {
    const roomId = takeRoom("KNG");
    const rr = await book({ roomId });
    expect((await checkIn(housekeeper, rr.id, { version: rr.version })).status).toBe(403);
    expect((await checkIn(resAgent, rr.id, { version: rr.version })).status).toBe(403);
    expect((await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe(
      "RESERVED",
    );
    expect((await roomState(roomId)).frontOfficeStatus).toBe("VACANT");
  });

  it("isolates properties: no cross-property check-in, room or disclosure", async () => {
    const rr = await book({ roomId: takeRoom("KNG") });
    // Another property's manager, on A's path: 403 without disclosure.
    const denied = await checkIn(gmB, rr.id, { version: rr.version });
    expect(denied.status).toBe(403);
    // On B's own path, A's reservation room does not exist.
    const hidden = await checkIn(gmB, rr.id, { version: rr.version }, B);
    expect(hidden.status).toBe(404);
    // A room of property B cannot be used at property A.
    const foreignRoom = await checkIn(agent, rr.id, {
      version: rr.version,
      roomId: invB.roomTypes.KNG!.roomIds[0]!,
    });
    expect(foreignRoom.status).toBe(404);
    expect(await prisma.stay.count({ where: { reservationRoomId: rr.id } })).toBe(0);
  });

  it("blocks rooms that are not ready unless an authorized user accepts it with a reason", async () => {
    const roomId = takeRoom("KNG");
    await prisma.room.update({ where: { id: roomId }, data: { housekeepingStatus: "DIRTY" } });
    const rr = await book({ roomId });
    const blocked = await checkIn(agent, rr.id, { version: rr.version });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details).toMatchObject({
      reason: "ROOM_NOT_READY",
      readiness: "DIRTY",
    });

    const noReason = await checkIn(agent, rr.id, { version: rr.version, acceptNotReady: true });
    expect(noReason.status).toBe(400);
    const accepted = await checkIn(agent, rr.id, {
      version: rr.version,
      acceptNotReady: true,
      reason: "Guest agreed to wait for a quick clean",
    });
    expect(accepted.status).toBe(201);
    const [audit] = await auditLogsFor(accepted.body.data.id);
    expect(audit).toMatchObject({ risk: "HIGH", reason: "Guest agreed to wait for a quick clean" });
    expect(audit!.after).toMatchObject({ acceptedReadiness: "DIRTY" });
  });

  it("refuses an occupied room (a due-out guest has not left yet)", async () => {
    const leaving = await inHouse("KNG", 1);
    await backdate(leaving.reservationRoomId, 1, 0); // departs today, still in house
    const arriving = await book();
    const r = await checkIn(agent, arriving.id, {
      version: arriving.version,
      roomId: leaving.roomId,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: "ROOM_OCCUPIED" });
    expect(await prisma.roomAssignment.count({ where: { reservationRoomId: arriving.id } })).toBe(
      0,
    );
  });

  it("rejects incompatible, unavailable and out-of-order rooms", async () => {
    const rr = await book();
    const twin = await checkIn(agent, rr.id, { version: rr.version, roomId: takeRoom("TWN") });
    expect(twin.status).toBe(422);
    expect(twin.body.error.details.reason).toBe("ROOM_TYPE_MISMATCH");

    // Assigned to another guest for tomorrow: the exclusion constraint answers 409.
    const taken = takeRoom("KNG");
    await book({ arrival: addDays(D, 1), departure: addDays(D, 3), roomId: taken });
    const clash = await checkIn(agent, rr.id, { version: rr.version, roomId: taken });
    expect(clash.status).toBe(409);

    const broken = takeRoom("KNG");
    await prisma.roomServiceBlock.create({
      data: {
        propertyId: A,
        roomId: broken,
        kind: "OUT_OF_ORDER",
        status: "ACTIVE",
        fromDate: fromDateOnly(D),
        toDate: fromDateOnly(addDays(D, 2)),
        reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
        createdById: org.adminId,
      },
    });
    const ooo = await checkIn(agent, rr.id, { version: rr.version, roomId: broken });
    expect(ooo.status).toBe(422);
    expect(ooo.body.error.details.reason).toBe("ROOM_OUT_OF_ORDER");
    expect((await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe(
      "RESERVED",
    );
  });

  it("lets exactly one of two concurrent check-ins into the only eligible room succeed", async () => {
    const onlyRoom = takeRoom("SGL");
    const sgl = invA.roomTypes.SGL!.id;
    const first = await book({ roomTypeId: sgl, adults: 1, departure: addDays(D, 1) });
    // The second guest was overbooked by the manager.
    const second = await book({
      roomTypeId: sgl,
      adults: 1,
      departure: addDays(D, 1),
      override: true,
      reason: "Overbooked walk-up for the test",
    });
    const results = await Promise.all([
      checkIn(agent, first.id, { version: first.version, roomId: onlyRoom }),
      checkIn(fom, second.id, { version: second.version, roomId: onlyRoom }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.stay.count({ where: { roomId: onlyRoom, status: "IN_HOUSE" } })).toBe(1);
    expect(
      await prisma.roomAssignment.count({ where: { roomId: onlyRoom, status: "ACTIVE" } }),
    ).toBe(1);
    expect(
      await prisma.reservationRoom.count({
        where: { id: { in: [first.id, second.id] }, status: "IN_HOUSE" },
      }),
    ).toBe(1);
    expect((await roomState(onlyRoom)).frontOfficeStatus).toBe("OCCUPIED");
  });

  it("refuses commands while night audit holds the business date", async () => {
    const rr = await book({ roomId: takeRoom("KNG") });
    await prisma.businessDate.updateMany({
      where: { propertyId: A, isCurrent: true },
      data: { status: "IN_AUDIT" },
    });
    try {
      const r = await checkIn(agent, rr.id, { version: rr.version });
      expect(r.status).toBe(423);
      expect(r.body.error.code).toBe("BUSINESS_DATE_LOCKED");
    } finally {
      await prisma.businessDate.updateMany({
        where: { propertyId: A, isCurrent: true },
        data: { status: "OPEN" },
      });
    }
    expect(await prisma.stay.count({ where: { reservationRoomId: rr.id } })).toBe(0);
  });
});

describe("walk-in", () => {
  it("books and checks in within one transaction", async () => {
    const roomId = takeRoom("KNG");
    const r = await call(walkInRoute, {
      method: "POST",
      path: `${base(A)}/front-desk/walk-ins`,
      params: { propertyId: A },
      body: {
        arrival: D,
        departure: addDays(D, 1),
        adults: 1,
        roomTypeId: invA.roomTypes.KNG!.id,
        ratePlanId: invA.ratePlans.BAR!,
        reservationTypeId: invA.reservationTypes.GTD!,
        guestId,
        roomId,
        externalReference: `WALK-${org.suffix}`,
      },
      jar: agent,
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: "IN_HOUSE", isWalkIn: true, room: { id: roomId } });
    const rr = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: r.body.data.reservationRoomId },
      include: { reservation: true },
    });
    expect(rr).toMatchObject({ status: "IN_HOUSE", isWalkIn: true, roomId });
    expect(rr.reservation.confirmationNumber).toMatch(/^\d{6,}$/);
    const creation = await auditLogsFor(rr.reservationId);
    expect(creation[0]!.after).toMatchObject({ walkIn: true });
  });

  it("leaves no reservation behind when the check-in part fails", async () => {
    const roomId = takeRoom("KNG");
    await prisma.room.update({ where: { id: roomId }, data: { housekeepingStatus: "DIRTY" } });
    const reference = `WALKFAIL-${org.suffix}`;
    const r = await call(walkInRoute, {
      method: "POST",
      path: `${base(A)}/front-desk/walk-ins`,
      params: { propertyId: A },
      body: {
        arrival: D,
        departure: addDays(D, 1),
        adults: 1,
        roomTypeId: invA.roomTypes.KNG!.id,
        ratePlanId: invA.ratePlans.BAR!,
        reservationTypeId: invA.reservationTypes.GTD!,
        guestId,
        roomId,
        externalReference: reference,
      },
      jar: agent,
    });
    expect(r.status).toBe(422);
    expect(
      await prisma.reservation.count({ where: { propertyId: A, externalReference: reference } }),
    ).toBe(0);

    const wrongDay = await call(walkInRoute, {
      method: "POST",
      path: `${base(A)}/front-desk/walk-ins`,
      params: { propertyId: A },
      body: {
        arrival: addDays(D, 1),
        departure: addDays(D, 2),
        adults: 1,
        roomTypeId: invA.roomTypes.KNG!.id,
        ratePlanId: invA.ratePlans.BAR!,
        reservationTypeId: invA.reservationTypes.GTD!,
        guestId,
        roomId: takeRoom("KNG"),
      },
      jar: agent,
    });
    expect(wrongDay.status).toBe(400);
  });
});

describe("room move", () => {
  it("moves an in-house guest, keeps the history and updates both rooms", async () => {
    const guest = await inHouse("KNG", 3);
    const target = takeRoom("KNG");
    const r = await move(agent, guest.stay.id, {
      version: guest.stay.version,
      roomId: target,
      reasonCodeId: invA.reasonCodes["ROOM_MOVE:NOISE"]!,
      reason: "Noise from the lift",
    });
    expect(r.status).toBe(200);
    expect(r.body.data.room.id).toBe(target);

    const assignments = await prisma.roomAssignment.findMany({
      where: { reservationRoomId: guest.reservationRoomId },
      orderBy: { createdAt: "asc" },
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toMatchObject({ roomId: guest.roomId, status: "RELEASED" });
    expect(assignments[0]!.toDate.toISOString().slice(0, 10)).toBe(D);
    expect(assignments[1]).toMatchObject({ roomId: target, status: "ACTIVE", kind: "MOVE" });
    expect(assignments[1]!.fromDate.toISOString().slice(0, 10)).toBe(D);

    expect(await roomState(guest.roomId)).toEqual({
      frontOfficeStatus: "VACANT",
      housekeepingStatus: "DIRTY",
    });
    expect((await roomState(target)).frontOfficeStatus).toBe("OCCUPIED");
    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: guest.stay.id } });
    expect(stay.roomId).toBe(target);
    const rr = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: guest.reservationRoomId },
    });
    expect(rr.roomId).toBe(target);

    const moveAudit = (await auditLogsFor(guest.stay.id)).find(
      (a) => a.action === "stay.room_move",
    );
    expect(moveAudit).toMatchObject({ risk: "HIGH", reason: "Noise from the lift" });
    expect(moveAudit!.before).toMatchObject({ roomId: guest.roomId });
    expect(moveAudit!.after).toMatchObject({ roomId: target, reasonCode: "NOISE" });

    // The stay view exposes the room history.
    const detail = await getStay(agent, guest.stay.id);
    expect(detail.body.data.assignments).toHaveLength(2);
    expect(detail.body.data.history.map((h: { action: string }) => h.action)).toContain(
      "stay.room_move",
    );
  });

  it("rejects invalid, unavailable and unauthorized moves", async () => {
    const guest = await inHouse("KNG", 3);
    const other = await inHouse("KNG", 3);
    const reasonCodeId = invA.reasonCodes["ROOM_MOVE:GUEST"]!;
    const body = (roomId: string) => ({ version: guest.stay.version, roomId, reasonCodeId });

    const occupied = await move(agent, guest.stay.id, body(other.roomId));
    expect(occupied.status).toBe(409);
    const wrongType = await move(agent, guest.stay.id, body(takeRoom("TWN")));
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.details.reason).toBe("ROOM_TYPE_MISMATCH");
    const same = await move(agent, guest.stay.id, body(guest.roomId));
    expect(same.status).toBe(400);
    const badReason = await move(agent, guest.stay.id, {
      ...body(takeRoom("KNG")),
      reasonCodeId: invA.reasonCodes["CANCELLATION:PLANS"]!,
    });
    expect(badReason.status).toBe(400);
    expect((await move(resAgent, guest.stay.id, body(takeRoom("KNG")))).status).toBe(403);
    expect((await move(gmB, guest.stay.id, body(takeRoom("KNG")))).status).toBe(403);
    expect((await move(gmB, guest.stay.id, body(takeRoom("KNG")), B)).status).toBe(404);

    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: guest.stay.id } });
    expect(stay).toMatchObject({ roomId: guest.roomId, version: guest.stay.version });
  });

  it("lets only one of two concurrent moves into the same room succeed", async () => {
    const g1 = await inHouse("KNG", 3);
    const g2 = await inHouse("KNG", 3);
    const target = takeRoom("KNG");
    const reasonCodeId = invA.reasonCodes["ROOM_MOVE:GUEST"]!;
    const results = await Promise.all([
      move(agent, g1.stay.id, { version: g1.stay.version, roomId: target, reasonCodeId }),
      move(fom, g2.stay.id, { version: g2.stay.version, roomId: target, reasonCodeId }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.stay.count({ where: { roomId: target, status: "IN_HOUSE" } })).toBe(1);
    expect(await prisma.roomAssignment.count({ where: { roomId: target, status: "ACTIVE" } })).toBe(
      1,
    );
  });

  it("does not move a guest who departs today", async () => {
    const guest = await inHouse("KNG", 1);
    await backdate(guest.reservationRoomId, 1, 0);
    const r = await move(agent, guest.stay.id, {
      version: guest.stay.version,
      roomId: takeRoom("KNG"),
      reasonCodeId: invA.reasonCodes["ROOM_MOVE:GUEST"]!,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.details.reason).toBe("NO_REMAINING_NIGHTS");
  });
});

describe("check-out", () => {
  it("checks out a due-out guest: stay, reservation, assignment and room lifecycle", async () => {
    const guest = await inHouse("KNG", 1);
    await backdate(guest.reservationRoomId, 2, 0);
    const r = await checkOut(agent, guest.stay.id, { version: guest.stay.version });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      status: "CHECKED_OUT",
      departureBusinessDate: D,
      allowedActions: { checkOut: false, moveRoom: false },
    });

    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: guest.stay.id } });
    expect(stay.status).toBe("CHECKED_OUT");
    expect(stay.checkedOutAt).not.toBeNull();
    expect(stay.departureBusinessDate!.toISOString().slice(0, 10)).toBe(D);
    expect(
      (await prisma.reservationRoom.findUniqueOrThrow({ where: { id: guest.reservationRoomId } }))
        .status,
    ).toBe("CHECKED_OUT");
    expect(
      await prisma.roomAssignment.count({
        where: { reservationRoomId: guest.reservationRoomId, status: "ACTIVE" },
      }),
    ).toBe(0);
    expect(await roomState(guest.roomId)).toEqual({
      frontOfficeStatus: "VACANT",
      housekeepingStatus: "DIRTY",
    });
    const sources = (
      await prisma.roomStatusHistory.findMany({
        where: { roomId: guest.roomId },
        orderBy: { createdAt: "asc" },
      })
    ).map((h) => `${h.source}:${h.field}:${h.toValue}`);
    expect(sources).toEqual([
      "CHECK_IN:FRONT_OFFICE:OCCUPIED",
      "CHECK_OUT:FRONT_OFFICE:VACANT",
      "CHECK_OUT:HOUSEKEEPING:DIRTY",
    ]);
    const audit = (await auditLogsFor(guest.stay.id)).find((a) => a.action === "stay.check_out");
    expect(audit!.after).toMatchObject({ timing: "ON_TIME", roomHousekeepingStatus: "DIRTY" });

    // The room can take the next guest once housekeeping has cleaned it.
    await prisma.room.update({
      where: { id: guest.roomId },
      data: { housekeepingStatus: "CLEAN" },
    });
    const next = await book({ roomId: guest.roomId });
    expect((await checkIn(agent, next.id, { version: next.version })).status).toBe(201);
  });

  it("refuses a duplicate check-out and an unknown or foreign stay", async () => {
    const guest = await inHouse("KNG", 1);
    await backdate(guest.reservationRoomId, 1, 0);
    expect((await checkOut(agent, guest.stay.id, { version: guest.stay.version })).status).toBe(
      200,
    );
    expect((await checkOut(agent, guest.stay.id, { version: guest.stay.version })).status).toBe(
      409,
    );
    const fresh = await prisma.stay.findUniqueOrThrow({ where: { id: guest.stay.id } });
    const again = await checkOut(agent, guest.stay.id, { version: fresh.version });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("INVALID_STATE_TRANSITION");

    const unknown = "01900000-0000-7000-8000-00000000abcd";
    expect((await checkOut(agent, unknown, { version: 1 })).status).toBe(404);
    expect((await checkOut(gmB, guest.stay.id, { version: fresh.version })).status).toBe(403);
    expect((await checkOut(gmB, guest.stay.id, { version: fresh.version }, B)).status).toBe(404);
    expect((await getStay(gmB, guest.stay.id, B)).status).toBe(404);
    expect((await checkOut(housekeeper, guest.stay.id, { version: fresh.version })).status).toBe(
      403,
    );
  });

  it("lets only one of two concurrent check-outs of the same stay succeed", async () => {
    const guest = await inHouse("KNG", 1);
    await backdate(guest.reservationRoomId, 1, 0);
    const results = await Promise.all([
      checkOut(agent, guest.stay.id, { version: guest.stay.version }),
      checkOut(fom, guest.stay.id, { version: guest.stay.version }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const audits = (await auditLogsFor(guest.stay.id)).filter((a) => a.action === "stay.check_out");
    expect(audits).toHaveLength(1);
    const history = await prisma.roomStatusHistory.count({
      where: { roomId: guest.roomId, source: "CHECK_OUT" },
    });
    expect(history).toBe(2);
  });

  it("requires confirmation for an early departure and releases the unused nights", async () => {
    const guest = await inHouse("KNG", 1);
    await backdate(guest.reservationRoomId, 1, 2); // booked until D + 2
    const unconfirmed = await checkOut(agent, guest.stay.id, { version: guest.stay.version });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.error.details.reason).toBe("EARLY_DEPARTURE_NOT_CONFIRMED");

    const nightsBefore = await prisma.reservationRoomNight.count({
      where: { reservationRoomId: guest.reservationRoomId },
    });
    expect(nightsBefore).toBe(3);
    const r = await checkOut(agent, guest.stay.id, {
      version: guest.stay.version,
      earlyDeparture: true,
      reasonCodeId: invA.reasonCodes["EARLY_DEPARTURE:PLANS"]!,
      reason: "Flight moved forward",
    });
    expect(r.status).toBe(200);
    const rr = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: guest.reservationRoomId },
    });
    expect(rr.departureDate.toISOString().slice(0, 10)).toBe(D);
    expect(
      await prisma.reservationRoomNight.count({
        where: { reservationRoomId: guest.reservationRoomId },
      }),
    ).toBe(1);
    const audit = (await auditLogsFor(guest.stay.id)).find((a) => a.action === "stay.check_out");
    expect(audit).toMatchObject({ risk: "HIGH", reason: "Flight moved forward" });
    expect(audit!.after).toMatchObject({ timing: "EARLY", releasedNights: 2, departure: D });
  });

  it("refuses to check out a guest who arrived today (reverse check-in territory)", async () => {
    const guest = await inHouse("KNG", 2);
    const r = await checkOut(agent, guest.stay.id, {
      version: guest.stay.version,
      earlyDeparture: true,
      reasonCodeId: invA.reasonCodes["EARLY_DEPARTURE:PLANS"]!,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.details.reason).toBe("SAME_DAY_CHECK_OUT");
  });
});

describe("front desk lists", () => {
  it("lists arrivals, in-house guests, departures and the room board for the business date", async () => {
    const arriving = await book({ roomId: takeRoom("KNG") });
    const unassigned = await book();
    const staying = await inHouse("KNG", 2);
    const leaving = await inHouse("KNG", 1);
    await backdate(leaving.reservationRoomId, 1, 0);

    const arrivals = await list(arrivalsRoute, "arrivals", agent, "limit=200");
    expect(arrivals.status).toBe(200);
    const ids = arrivals.body.data.map((r: { reservationRoomId: string }) => r.reservationRoomId);
    expect(ids).toEqual(
      expect.arrayContaining([arriving.id, unassigned.id, staying.reservationRoomId]),
    );
    const byId = new Map(
      arrivals.body.data.map((r: { reservationRoomId: string }) => [r.reservationRoomId, r]),
    );
    expect(byId.get(arriving.id)).toMatchObject({ state: "READY", room: { readiness: "READY" } });
    expect(byId.get(unassigned.id)).toMatchObject({ state: "UNASSIGNED", room: null });
    expect(byId.get(staying.reservationRoomId)).toMatchObject({ state: "CHECKED_IN" });

    const onlyUnassigned = await list(
      arrivalsRoute,
      "arrivals",
      agent,
      "filter=unassigned&limit=200",
    );
    expect(onlyUnassigned.body.data.every((r: { room: unknown }) => r.room === null)).toBe(true);

    const page1 = await list(arrivalsRoute, "arrivals", agent, "limit=2");
    expect(page1.body.data).toHaveLength(2);
    const page2 = await list(
      arrivalsRoute,
      "arrivals",
      agent,
      `limit=2&cursor=${page1.body.meta.nextCursor}`,
    );
    const pageIds = [...page1.body.data, ...page2.body.data].map(
      (r: { reservationRoomId: string }) => r.reservationRoomId,
    );
    expect(new Set(pageIds).size).toBe(pageIds.length);

    const house = await list(inHouseRoute, "in-house", agent, "limit=200");
    const stayIds = house.body.data.map((r: { stayId: string }) => r.stayId);
    expect(stayIds).toEqual(expect.arrayContaining([staying.stay.id, leaving.stay.id]));

    const dueOut = await list(departuresRoute, "departures", agent, "filter=due_out&limit=200");
    const dueIds = dueOut.body.data.map((r: { stayId: string }) => r.stayId);
    expect(dueIds).toContain(leaving.stay.id);
    expect(dueIds).not.toContain(staying.stay.id);

    const board = await call(roomBoardRoute, {
      path: `${base(A)}/front-desk/rooms?filter=occupied`,
      params: { propertyId: A },
      jar: agent,
    });
    expect(board.status).toBe(200);
    const occupied = board.body.data.map((r: { id: string }) => r.id);
    expect(occupied).toEqual(expect.arrayContaining([staying.roomId, leaving.roomId]));

    const summary = await call(summaryRoute, {
      path: `${base(A)}/front-desk/summary`,
      params: { propertyId: A },
      jar: agent,
    });
    expect(summary.body.data.businessDate).toBe(D);
    expect(summary.body.data.inHouse.total).toBeGreaterThanOrEqual(2);
    expect(summary.body.data.departures.dueOut).toBeGreaterThanOrEqual(1);

    const options = await call(roomOptionsRoute, {
      path: `${base(A)}/reservation-rooms/${unassigned.id}/room-options`,
      params: { propertyId: A, reservationRoomId: unassigned.id },
      jar: agent,
    });
    expect(options.status).toBe(200);
    const optionIds = options.body.data.map((o: { id: string }) => o.id);
    expect(optionIds).not.toContain(staying.roomId);
    expect(options.body.data[0].readiness).toBe("READY");
  });

  it("enforces permissions and property scope on the lists", async () => {
    expect((await list(arrivalsRoute, "arrivals", housekeeper)).status).toBe(403);
    expect((await list(arrivalsRoute, "arrivals", resAgent)).status).toBe(403);
    expect((await list(arrivalsRoute, "arrivals", gmB)).status).toBe(403);
    const own = await list(arrivalsRoute, "arrivals", gmB, "", B);
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual([]);
  });

  it("exposes front desk actions on the reservation detail", async () => {
    const rr = await book({ roomId: takeRoom("KNG") });
    const reservationId = (await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr.id } }))
      .reservationId;
    const detail = (jar: CookieJar) =>
      call(detailRoute, {
        path: `${base(A)}/reservations/${reservationId}`,
        params: { propertyId: A, reservationId },
        jar,
      });
    expect((await detail(agent)).body.data.rooms[0].allowedActions.checkIn).toBe(true);
    expect((await detail(resAgent)).body.data.rooms[0].allowedActions.checkIn).toBe(false);
    await checkIn(agent, rr.id, { version: rr.version });
    const after = (await detail(agent)).body.data.rooms[0];
    expect(after.stay).toMatchObject({ status: "IN_HOUSE" });
    expect(after.allowedActions).toMatchObject({ checkIn: false, modify: false, moveRoom: true });
  });
});

describe("room assignment before arrival (Phase 2 endpoint)", () => {
  it("keeps working for due-in reservations and refuses in-house ones", async () => {
    const rr = await book();
    const roomId = takeRoom("KNG");
    const assigned = await call(assignRoute, {
      method: "POST",
      path: `${base(A)}/reservation-rooms/${rr.id}/assign-room`,
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: rr.version, roomId },
      jar: agent,
    });
    expect(assigned.status).toBe(200);
    const checked = await checkIn(agent, rr.id, { version: rr.version + 1 });
    expect(checked.status).toBe(201);
    const reassign = await call(assignRoute, {
      method: "POST",
      path: `${base(A)}/reservation-rooms/${rr.id}/assign-room`,
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: rr.version + 2, roomId: takeRoom("KNG") },
      jar: agent,
    });
    expect(reassign.status).toBe(422);
  });
});
