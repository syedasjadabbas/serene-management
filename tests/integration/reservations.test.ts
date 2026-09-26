import { beforeAll, describe, expect, it } from "vitest";
import { GET as guestsSearch, POST as guestsCreate } from "@/app/api/v1/guests/route";
import { GET as availabilityRoute } from "@/app/api/v1/properties/[propertyId]/availability/route";
import { POST as assignRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/assign-room/route";
import { POST as cancelRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/cancel/route";
import { POST as confirmRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/confirm/route";
import { POST as noShowRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/no-show/route";
import { POST as reinstateRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/reinstate/route";
import { PATCH as updateRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/route";
import { GET as detailRoute } from "@/app/api/v1/properties/[propertyId]/reservations/[reservationId]/route";
import {
  GET as listRoute,
  POST as createRoute,
} from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { prisma } from "@/lib/db/prisma";
import { addDays } from "@/modules/business-date/business-date.policy";
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
let fom: CookieJar; // front office manager @ A
let agent: CookieJar; // front desk agent @ A
let housekeeper: CookieJar;
let gmB: CookieJar;
let guestId: string;

const resPath = (propertyId: string) => `/api/v1/properties/${propertyId}/reservations`;
const roomPath = (propertyId: string, id: string, action = "") =>
  `/api/v1/properties/${propertyId}/reservation-rooms/${id}${action ? `/${action}` : ""}`;

function booking(overrides: Record<string, unknown> = {}) {
  return {
    arrival: addDays(D, 10),
    departure: addDays(D, 12),
    adults: 2,
    children: 0,
    rooms: 1,
    roomTypeId: invA.roomTypes.KNG!.id,
    ratePlanId: invA.ratePlans.BAR!,
    reservationTypeId: invA.reservationTypes.GTD!,
    guestId,
    ...overrides,
  };
}

async function create(jar: CookieJar, body: Record<string, unknown>, propertyId = A) {
  return call(createRoute, {
    method: "POST",
    path: resPath(propertyId),
    params: { propertyId },
    body,
    jar,
  });
}

async function command(
  route: typeof cancelRoute,
  jar: CookieJar,
  reservationRoomId: string,
  action: string,
  body: Record<string, unknown>,
) {
  return call(route, {
    method: "POST",
    path: roomPath(A, reservationRoomId, action),
    params: { propertyId: A, reservationRoomId },
    body,
    jar,
  });
}

async function counter(roomTypeId: string, date: string) {
  return prisma.roomTypeInventory.findUnique({
    where: { roomTypeId_stayDate: { roomTypeId, stayDate: new Date(`${date}T00:00:00.000Z`) } },
    select: { sold: true, physicalRooms: true },
  });
}

async function availability(query: Record<string, string>, jar = fom) {
  const qs = new URLSearchParams(query).toString();
  return call(availabilityRoute, {
    path: `/api/v1/properties/${A}/availability?${qs}`,
    params: { propertyId: A },
    jar,
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
    { code: "KNG", rooms: 5 },
    { code: "TWN", rooms: 2 },
    { code: "SGL", rooms: 1, maxOccupancy: 1 },
  ]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 3 }]);
  D = invA.businessDate;
  guestId = (await createGuestRow(org, "Hamza", "Qureshi")).id;

  const fomUser = await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]);
  const agentUser = await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
  const hkUser = await createUser(org, "hk", [{ role: "HOUSEKEEPER", property: "A" }]);
  const gmBUser = await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]);
  fom = await loginAs(fomUser.email, TEST_PASSWORD);
  agent = await loginAs(agentUser.email, TEST_PASSWORD);
  housekeeper = await loginAs(hkUser.email, TEST_PASSWORD);
  gmB = await loginAs(gmBUser.email, TEST_PASSWORD);
}, 120_000);

describe("create and retrieve", () => {
  it("creates a reservation with nights, a confirmation number, inventory and an audit record", async () => {
    const r = await create(agent, booking({ specialRequests: "High floor please", eta: "15:30" }));
    expect(r.status).toBe(201);
    const detail = r.body.data;
    // Property-prefixed (D36): the prefix defaults to the property code.
    expect(detail.confirmationNumber).toMatch(new RegExp(`^${org.properties.A!.code}-\\d{6,}$`));
    const room = detail.rooms[0];
    expect(room).toMatchObject({
      status: "RESERVED",
      bookingState: "CONFIRMED",
      nights: 2,
      eta: "15:30",
    });
    expect(room.totalAmount).toBe("24000.00"); // weekday/weekend aware: verified against nights below

    const rows = await prisma.reservationRoomNight.findMany({
      where: { reservationRoomId: room.id },
      orderBy: { stayDate: "asc" },
      select: { stayDate: true, rateAmount: true },
    });
    expect(rows.map((n) => n.stayDate.toISOString().slice(0, 10))).toEqual([
      addDays(D, 10),
      addDays(D, 11),
    ]);
    const total = rows.reduce((acc, n) => acc + Number(n.rateAmount.toFixed(2)), 0);
    expect(room.totalAmount).toBe(total.toFixed(2));

    expect((await counter(invA.roomTypes.KNG!.id, addDays(D, 10)))?.sold).toBeGreaterThanOrEqual(1);
    expect(await prisma.reservationNote.count({ where: { reservationId: detail.id } })).toBe(1);

    const audit = await auditLogsFor(detail.id);
    expect(audit[0]).toMatchObject({
      action: "reservation.create",
      propertyId: A,
      risk: "STANDARD",
    });
    expect((audit[0]!.after as { confirmationNumber: string }).confirmationNumber).toBe(
      detail.confirmationNumber,
    );

    const fetched = await call(detailRoute, {
      path: `${resPath(A)}/${detail.id}`,
      params: { propertyId: A, reservationId: detail.id },
      jar: agent,
    });
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.rooms[0].nightly).toHaveLength(2);
    expect(fetched.body.data.history[0].action).toBe("reservation.create");
  });

  it("never accepts client-supplied confirmation numbers, statuses or prices", async () => {
    for (const extra of [
      { confirmationNumber: "999999" },
      { status: "CANCELLED" },
      { rateAmount: "1.00" },
    ]) {
      expect((await create(agent, booking(extra))).status).toBe(400);
    }
  });

  it("rejects invalid dates and occupancy", async () => {
    const same = await create(agent, booking({ departure: addDays(D, 10) }));
    expect(same.status).toBe(400);
    const past = await create(
      agent,
      booking({ arrival: addDays(D, -1), departure: addDays(D, 1) }),
    );
    expect(past.status).toBe(400);
    expect(past.body.error.details.fields.arrival).toBeDefined();
    const crowded = await create(agent, booking({ roomTypeId: invA.roomTypes.SGL!.id, adults: 2 }));
    expect(crowded.status).toBe(422);
    expect(crowded.body.error.details.reason).toBe("OCCUPANCY");
  });

  it("allocates unique, consecutive confirmation numbers under concurrency", async () => {
    const results = await Promise.all(
      [20, 22, 24, 26, 28].map((offset) =>
        create(agent, booking({ arrival: addDays(D, offset), departure: addDays(D, offset + 1) })),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const numbers = results
      .map((r) => Number(String(r.body.data.confirmationNumber).split("-").pop()))
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(5);
    expect(numbers.at(-1)! - numbers[0]!).toBe(4);
  });
});

describe("availability", () => {
  it("reflects reservations, tentative bookings and out-of-order rooms", async () => {
    const arrival = addDays(D, 50);
    const departure = addDays(D, 52);
    await create(agent, booking({ arrival, departure }));
    await create(
      agent,
      booking({ arrival, departure, reservationTypeId: invA.reservationTypes.TENT! }),
    );
    await prisma.roomServiceBlock.create({
      data: {
        propertyId: A,
        roomId: invA.roomTypes.KNG!.roomIds[4]!,
        kind: "OUT_OF_ORDER",
        status: "SCHEDULED",
        fromDate: new Date(`${arrival}T00:00:00.000Z`),
        toDate: new Date(`${departure}T00:00:00.000Z`),
        reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
        createdById: org.adminId,
      },
    });
    const r = await availability({ arrival, departure, adults: "2" });
    expect(r.status).toBe(200);
    const kng = r.body.data.roomTypes.find(
      (rt: { roomType: { code: string } }) => rt.roomType.code === "KNG",
    );
    expect(kng).toMatchObject({
      physical: 5,
      outOfOrder: 1,
      reserved: 1,
      tentative: 1,
      available: 3,
      status: "AVAILABLE",
    });
    // Public quotes: BAR, its derived plans and the bed & breakfast plan (Phase 6
    // fixture data); the GRP group rate is sold only through a block pickup.
    expect(kng.rates.map((rate: { ratePlan: { code: string } }) => rate.ratePlan.code)).toEqual([
      "BAR",
      "ADV",
      "BBK",
    ]);
    const sgl = r.body.data.roomTypes.find(
      (rt: { roomType: { code: string } }) => rt.roomType.code === "SGL",
    );
    expect(sgl.status).toBe("NOT_SUITABLE");
  });

  it("validates the query and the business date", async () => {
    expect(
      (await availability({ arrival: addDays(D, 5), departure: addDays(D, 5), adults: "1" }))
        .status,
    ).toBe(400);
    expect(
      (await availability({ arrival: addDays(D, -1), departure: addDays(D, 1), adults: "1" }))
        .status,
    ).toBe(400);
    expect(
      (await availability({ arrival: "tomorrow", departure: addDays(D, 1), adults: "1" })).status,
    ).toBe(400);
  });

  it("enforces restrictions unless an authorized override is given", async () => {
    const arrival = addDays(D, 70);
    await prisma.restriction.create({
      data: {
        propertyId: A,
        stayDate: new Date(`${arrival}T00:00:00.000Z`),
        type: "MIN_LOS",
        value: 3,
        createdById: org.adminId,
      },
    });
    const blocked = await create(agent, booking({ arrival, departure: addDays(arrival, 1) }));
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.reason).toBe("RESTRICTED");

    const agentOverride = await create(
      agent,
      booking({ arrival, departure: addDays(arrival, 1), override: true, reason: "VIP" }),
    );
    expect(agentOverride.status).toBe(403);

    const overridden = await create(
      fom,
      booking({
        arrival,
        departure: addDays(arrival, 1),
        override: true,
        reason: "GM approved short stay",
      }),
    );
    expect(overridden.status).toBe(201);
    const audit = await auditLogsFor(overridden.body.data.id);
    expect(audit[0]).toMatchObject({ risk: "HIGH", reason: "GM approved short stay" });
  });
});

describe("fully booked inventory", () => {
  it("rejects the booking that would oversell, offers the waitlist, and allows an audited override", async () => {
    const arrival = addDays(D, 80);
    const departure = addDays(D, 82);
    const twn = invA.roomTypes.TWN!.id;
    expect(
      (await create(agent, booking({ arrival, departure, roomTypeId: twn, rooms: 2 }))).status,
    ).toBe(201);
    const full = await create(agent, booking({ arrival, departure, roomTypeId: twn }));
    expect(full.status).toBe(422);
    expect(full.body.error.details).toMatchObject({ reason: "NO_AVAILABILITY", requested: 1 });

    const waitlisted = await create(
      agent,
      booking({ arrival, departure, roomTypeId: twn, waitlist: true }),
    );
    expect(waitlisted.status).toBe(201);
    expect(waitlisted.body.data.rooms[0].bookingState).toBe("WAITLISTED");
    expect((await counter(twn, arrival))?.sold).toBe(2);

    const confirmFull = await command(
      confirmRoute,
      fom,
      waitlisted.body.data.rooms[0].id,
      "confirm",
      {
        version: waitlisted.body.data.rooms[0].version,
        reservationTypeId: invA.reservationTypes.GTD,
      },
    );
    expect(confirmFull.status).toBe(422);

    const overbooked = await create(
      fom,
      booking({
        arrival,
        departure,
        roomTypeId: twn,
        override: true,
        reason: "Contracted guest, walk plan in place",
      }),
    );
    expect(overbooked.status).toBe(201);
    expect((await counter(twn, arrival))?.sold).toBe(3);
  });

  it("sells the last room exactly once under concurrent requests", async () => {
    const arrival = addDays(D, 90);
    const departure = addDays(D, 93);
    const sgl = invA.roomTypes.SGL!.id;
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        create(agent, booking({ arrival, departure, roomTypeId: sgl, adults: 1 })),
      ),
    );
    const statuses = attempts.map((a) => a.status).sort();
    expect(statuses).toEqual([201, 422, 422, 422, 422, 422]);
    for (const failed of attempts.filter((a) => a.status === 422)) {
      expect(failed.body.error.details.reason).toBe("NO_AVAILABILITY");
    }
    const sold = await prisma.reservationRoom.count({
      where: {
        propertyId: A,
        roomTypeId: sgl,
        arrivalDate: new Date(`${arrival}T00:00:00.000Z`),
        status: "RESERVED",
      },
    });
    expect(sold).toBe(1);
    expect((await counter(sgl, addDays(D, 91)))?.sold).toBe(1);
  });
});

describe("hotel-night room assignment", () => {
  it("allows back-to-back stays in one room but never overlapping ones", async () => {
    const roomId = invA.roomTypes.KNG!.roomIds[0]!;
    const first = await create(
      agent,
      booking({ arrival: addDays(D, 100), departure: addDays(D, 102), roomId }),
    );
    expect(first.status).toBe(201);
    expect(first.body.data.rooms[0].room.id).toBe(roomId);
    const backToBack = await create(
      agent,
      booking({ arrival: addDays(D, 102), departure: addDays(D, 104), roomId }),
    );
    expect(backToBack.status).toBe(201);
    const overlapping = await create(
      agent,
      booking({ arrival: addDays(D, 101), departure: addDays(D, 103), roomId }),
    );
    expect(overlapping.status).toBe(409);
    expect(await prisma.roomAssignment.count({ where: { roomId, status: "ACTIVE" } })).toBe(2);

    // Unassign and assign through the command as well.
    const rr = first.body.data.rooms[0];
    const unassigned = await command(assignRoute, agent, rr.id, "assign-room", {
      version: rr.version,
      roomId: null,
    });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.rooms[0].room).toBeNull();
  });
});

describe("lifecycle commands", () => {
  it("modifies dates with optimistic concurrency, re-prices and audits the change", async () => {
    const created = await create(
      agent,
      booking({ arrival: addDays(D, 110), departure: addDays(D, 112) }),
    );
    const rr = created.body.data.rooms[0];
    const modified = await call(updateRoute, {
      method: "PATCH",
      path: roomPath(A, rr.id),
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: rr.version, departure: addDays(D, 113), adults: 1 },
      jar: agent,
    });
    expect(modified.status).toBe(200);
    expect(modified.body.data.rooms[0]).toMatchObject({
      nights: 3,
      adults: 1,
      version: rr.version + 1,
    });
    expect(await prisma.reservationRoomNight.count({ where: { reservationRoomId: rr.id } })).toBe(
      3,
    );
    expect((await counter(invA.roomTypes.KNG!.id, addDays(D, 112)))?.sold).toBeGreaterThanOrEqual(
      1,
    );

    const audit = (await auditLogsFor(rr.id)).find((a) => a.action === "reservation.update");
    expect(audit?.before).toMatchObject({ departure: addDays(D, 112), adults: 2 });
    expect(audit?.after).toMatchObject({ departure: addDays(D, 113), adults: 1 });

    const stale = await call(updateRoute, {
      method: "PATCH",
      path: roomPath(A, rr.id),
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: rr.version, adults: 2 },
      jar: agent,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.reason).toBe("STALE_VERSION");
  });

  it("confirms a tentative reservation, deducting inventory", async () => {
    const arrival = addDays(D, 120);
    const created = await create(
      agent,
      booking({
        arrival,
        departure: addDays(arrival, 1),
        reservationTypeId: invA.reservationTypes.TENT!,
      }),
    );
    const rr = created.body.data.rooms[0];
    expect(rr.bookingState).toBe("TENTATIVE");
    expect((await counter(invA.roomTypes.KNG!.id, arrival))?.sold ?? 0).toBe(0);

    const confirmed = await command(confirmRoute, agent, rr.id, "confirm", {
      version: rr.version,
      reservationTypeId: invA.reservationTypes.GTD,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.rooms[0].bookingState).toBe("CONFIRMED");
    expect((await counter(invA.roomTypes.KNG!.id, arrival))?.sold).toBe(1);

    const again = await command(confirmRoute, agent, rr.id, "confirm", {
      version: confirmed.body.data.rooms[0].version,
      reservationTypeId: invA.reservationTypes.GTD,
    });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("cancels with a reason code, releases inventory and room, and can reinstate", async () => {
    const arrival = addDays(D, 130);
    const created = await create(
      agent,
      booking({ arrival, departure: addDays(arrival, 2), roomId: invA.roomTypes.KNG!.roomIds[2]! }),
    );
    const rr = created.body.data.rooms[0];
    expect((await counter(invA.roomTypes.KNG!.id, arrival))?.sold).toBe(1);

    const noReason = await command(cancelRoute, agent, rr.id, "cancel", {
      version: rr.version,
      reasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"],
    });
    expect(noReason.status).toBe(400);

    const cancelled = await command(cancelRoute, agent, rr.id, "cancel", {
      version: rr.version,
      reasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"],
      reason: "Guest emailed to cancel",
    });
    expect(cancelled.status).toBe(200);
    const row = await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr.id } });
    expect(row).toMatchObject({ status: "CANCELLED", roomId: null });
    expect(row.cancellationNumber).toMatch(/^X\d+$/);
    expect((await counter(invA.roomTypes.KNG!.id, arrival))?.sold).toBe(0);
    expect(
      await prisma.roomAssignment.count({ where: { reservationRoomId: rr.id, status: "ACTIVE" } }),
    ).toBe(0);
    const audit = (await auditLogsFor(rr.id)).find((a) => a.action === "reservation.cancel");
    expect(audit).toMatchObject({ risk: "HIGH", reason: "Guest emailed to cancel" });

    const twice = await command(cancelRoute, agent, rr.id, "cancel", {
      version: row.version,
      reasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"],
      reason: "Again",
    });
    expect(twice.status).toBe(422);

    const agentReinstate = await command(reinstateRoute, agent, rr.id, "reinstate", {
      version: row.version,
      reason: "Guest rebooked",
    });
    expect(agentReinstate.status).toBe(403);
    const reinstated = await command(reinstateRoute, fom, rr.id, "reinstate", {
      version: row.version,
      reason: "Guest rebooked",
    });
    expect(reinstated.status).toBe(200);
    expect(reinstated.body.data.rooms[0].bookingState).toBe("CONFIRMED");
    expect((await counter(invA.roomTypes.KNG!.id, arrival))?.sold).toBe(1);
  });

  it("marks no-shows only from the arrival date and only with permission", async () => {
    const today = await create(agent, booking({ arrival: D, departure: addDays(D, 1) }));
    const future = await create(
      agent,
      booking({ arrival: addDays(D, 140), departure: addDays(D, 141) }),
    );
    const body = (rr: { version: number }) => ({
      version: rr.version,
      reasonCodeId: invA.reasonCodes["NO_SHOW:NOSHOW"],
      reason: "Guest did not arrive",
    });
    const todayRoom = today.body.data.rooms[0];
    expect(
      (await command(noShowRoute, agent, todayRoom.id, "no-show", body(todayRoom))).status,
    ).toBe(403);
    const noShow = await command(noShowRoute, fom, todayRoom.id, "no-show", body(todayRoom));
    expect(noShow.status).toBe(200);
    expect(noShow.body.data.rooms[0].bookingState).toBe("NO_SHOW");
    expect(
      (await prisma.reservationRoom.findUniqueOrThrow({ where: { id: todayRoom.id } })).noShowAt,
    ).not.toBeNull();

    const futureRoom = future.body.data.rooms[0];
    const early = await command(noShowRoute, fom, futureRoom.id, "no-show", body(futureRoom));
    expect(early.status).toBe(422);
  });
});

describe("search", () => {
  it("finds by confirmation number and guest name, filters by state, and paginates", async () => {
    const guest = await createGuestRow(org, "Layla", "Haddad");
    const created = await create(
      agent,
      booking({ arrival: addDays(D, 150), departure: addDays(D, 151), guestId: guest.id }),
    );
    const confirmation = created.body.data.confirmationNumber;

    const list = (query: Record<string, string>) =>
      call(listRoute, {
        path: `${resPath(A)}?${new URLSearchParams(query).toString()}`,
        params: { propertyId: A },
        jar: agent,
      });

    const byNumber = await list({ q: confirmation });
    expect(
      byNumber.body.data.map((r: { confirmationNumber: string }) => r.confirmationNumber),
    ).toEqual([confirmation]);
    // The digits alone and a lower-case prefix find the prefixed number (D36).
    for (const q of [String(confirmation).split("-").pop()!, String(confirmation).toLowerCase()]) {
      const found = await list({ q });
      expect(
        found.body.data.map((r: { confirmationNumber: string }) => r.confirmationNumber),
      ).toContain(confirmation);
    }
    const byName = await list({ q: "hadd" });
    expect(
      byName.body.data.some((r: { guest: { name: string } }) => r.guest.name === "Haddad, Layla"),
    ).toBe(true);
    // Name words match in any order.
    for (const q of ["layla haddad", "haddad layla"]) {
      const found = await list({ q });
      expect(
        found.body.data.map((r: { confirmationNumber: string }) => r.confirmationNumber),
      ).toContain(confirmation);
    }

    const cancelledOnly = await list({ state: "CANCELLED" });
    expect(
      cancelledOnly.body.data.every(
        (r: { bookingState: string }) => r.bookingState === "CANCELLED",
      ),
    ).toBe(true);

    const first = await list({ limit: "2" });
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    const second = await list({ limit: "2", cursor: first.body.meta.nextCursor });
    const ids = [...first.body.data, ...second.body.data].map(
      (r: { reservationRoomId: string }) => r.reservationRoomId,
    );
    expect(new Set(ids).size).toBe(4);
    const arrivals = [...first.body.data, ...second.body.data].map(
      (r: { arrival: string }) => r.arrival,
    );
    expect([...arrivals].sort()).toEqual(arrivals);
  });
});

describe("guests", () => {
  it("creates a guest profile and finds it with a bounded server-side search", async () => {
    const created = await call(guestsCreate, {
      method: "POST",
      path: "/api/v1/guests",
      body: { firstName: "Sofía", lastName: "Rossi", email: "Sofia.Rossi@Example.com" },
      jar: agent,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      fullName: "Sofía Rossi",
      email: "sofia.rossi@example.com",
    });
    const found = await call(guestsSearch, { path: "/api/v1/guests?q=sofia%20ros", jar: agent });
    expect(found.body.data.map((g: { id: string }) => g.id)).toContain(created.body.data.id);
    expect((await call(guestsSearch, { path: "/api/v1/guests?q=a", jar: agent })).status).toBe(400);
  });
});

describe("authorization and property isolation", () => {
  it("rejects users without reservation permissions", async () => {
    expect(
      (await call(listRoute, { path: resPath(A), params: { propertyId: A }, jar: housekeeper }))
        .status,
    ).toBe(403);
    expect((await create(housekeeper, booking())).status).toBe(403);
    expect(
      (
        await availability(
          { arrival: addDays(D, 5), departure: addDays(D, 6), adults: "1" },
          housekeeper,
        )
      ).status,
    ).toBe(403);
  });

  it("keeps property B's reservations out of reach from property A", async () => {
    const guestB = await createGuestRow(org, "Omar", "Haddad");
    const inB = await create(
      gmB,
      {
        arrival: addDays(invB.businessDate, 5),
        departure: addDays(invB.businessDate, 6),
        adults: 1,
        roomTypeId: invB.roomTypes.KNG!.id,
        ratePlanId: invB.ratePlans.BAR!,
        reservationTypeId: invB.reservationTypes.GTD!,
        guestId: guestB.id,
      },
      B,
    );
    expect(inB.status).toBe(201);
    const bReservation = inB.body.data;

    // B's reservation through A's path: not found (never another property's data).
    const viaA = await call(detailRoute, {
      path: `${resPath(A)}/${bReservation.id}`,
      params: { propertyId: A, reservationId: bReservation.id },
      jar: fom,
    });
    expect(viaA.status).toBe(404);

    // B's path directly: the property itself is refused.
    const viaB = await call(detailRoute, {
      path: `${resPath(B)}/${bReservation.id}`,
      params: { propertyId: B, reservationId: bReservation.id },
      jar: fom,
    });
    expect(viaB.status).toBe(403);

    // Commands with B's reservation-room id under A's path cannot touch it.
    const bRoom = bReservation.rooms[0];
    const cancel = await command(cancelRoute, fom, bRoom.id, "cancel", {
      version: bRoom.version,
      reasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"],
      reason: "Cross-property attempt",
    });
    expect(cancel.status).toBe(404);
    expect(
      (await prisma.reservationRoom.findUniqueOrThrow({ where: { id: bRoom.id } })).status,
    ).toBe("RESERVED");

    // A's room type and rate plan cannot be booked into B.
    const mixed = await create(
      gmB,
      booking({ arrival: addDays(invB.businessDate, 7), departure: addDays(invB.businessDate, 8) }),
      B,
    );
    expect(mixed.status).toBe(404);

    // A's list never includes B.
    const listA = await call(listRoute, {
      path: `${resPath(A)}?q=${bReservation.confirmationNumber}`,
      params: { propertyId: A },
      jar: fom,
    });
    expect(
      listA.body.data.every((r: { reservationId: string }) => r.reservationId !== bReservation.id),
    ).toBe(true);
  });
});
