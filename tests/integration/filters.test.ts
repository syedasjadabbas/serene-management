import { beforeAll, describe, expect, it } from "vitest";
import { GET as accountsRoute, POST as createAccountRoute } from "@/app/api/v1/accounts/route";
import { GET as foliosRoute } from "@/app/api/v1/properties/[propertyId]/folios/route";
import { GET as arrivalsRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/arrivals/route";
import { GET as inHouseRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/in-house/route";
import { GET as hkSummaryRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/summary/route";
import { GET as tasksRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import {
  GET as listRoute,
  POST as createRoute,
} from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

/**
 * Filters, sort, pagination and search across the list endpoints the UI
 * filters on: each filter narrows the server's result, filters combine,
 * invalid ranges are rejected, and nothing crosses the property boundary.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let A: string;
let B: string;
let invA: Inventory;
let invB: Inventory;
let D: string;
let admin: CookieJar; // organization admin: every permission
let fomA: CookieJar; // front office manager at A only
let guestId: string;
let otherGuestId: string;

const base = (propertyId: string) => `/api/v1/properties/${propertyId}`;

async function book(overrides: Record<string, unknown> = {}, propertyId = A) {
  const inv = propertyId === A ? invA : invB;
  const r = await call(createRoute, {
    method: "POST",
    path: `${base(propertyId)}/reservations`,
    params: { propertyId },
    body: {
      arrival: addDays(D, 5),
      departure: addDays(D, 7),
      adults: 2,
      children: 0,
      rooms: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
      ...overrides,
    },
    jar: admin,
  });
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  const room = r.body.data.rooms[0] as { id: string; version: number };
  const confirmation = r.body.data.confirmationNumber as string;
  return { ...room, reservationId: r.body.data.id as string, confirmation };
}

function listReservations(query: string, jar = admin, propertyId = A) {
  return call(listRoute, {
    path: `${base(propertyId)}/reservations?${query}`,
    params: { propertyId },
    jar,
  });
}

const ids = (body: { data: { reservationRoomId: string }[] }) =>
  body.data.map((row) => row.reservationRoomId);

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
    { code: "KNG", rooms: 8 },
    { code: "TWN", rooms: 4 },
  ]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 3 }]);
  D = invA.businessDate;
  await prisma.room.updateMany({
    where: { propertyId: { in: [A, B] } },
    data: { frontOfficeStatus: "VACANT", housekeepingStatus: "CLEAN" },
  });
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { id: org.adminId },
    select: { email: true },
  });
  admin = await loginAs(adminUser.email, TEST_PASSWORD);
  const fom = await createUser(org, "filters-fom", [
    { role: "FRONT_OFFICE_MANAGER", property: "A" },
  ]);
  fomA = await loginAs(fom.email, TEST_PASSWORD);
  guestId = (await createGuestRow(org, "Zelda", "Quartermain")).id;
  otherGuestId = (await createGuestRow(org, "Yusuf", "Bellweather")).id;
}, 120_000);

describe("reservation list filters", () => {
  it("combines search, state and room type, and sorts both ways", async () => {
    const kng = await book({ arrival: addDays(D, 3), departure: addDays(D, 4) });
    const twn = await book({
      arrival: addDays(D, 6),
      departure: addDays(D, 8),
      roomTypeId: invA.roomTypes.TWN!.id,
    });
    const other = await book({
      arrival: addDays(D, 4),
      departure: addDays(D, 5),
      guestId: otherGuestId,
    });

    const byName = await listReservations("q=quartermain&limit=50");
    expect(byName.status).toBe(200);
    expect(ids(byName.body)).toEqual(expect.arrayContaining([kng.id, twn.id]));
    expect(ids(byName.body)).not.toContain(other.id);

    const nameAndType = await listReservations(
      `q=quartermain&roomTypeId=${invA.roomTypes.TWN!.id}&limit=50`,
    );
    expect(ids(nameAndType.body)).toEqual([twn.id]);

    const withState = await listReservations("q=quartermain&state=CANCELLED&limit=50");
    expect(ids(withState.body)).toEqual([]);

    const ascending = ids((await listReservations("q=quartermain&sort=arrival&limit=50")).body);
    const descending = ids((await listReservations("q=quartermain&sort=-arrival&limit=50")).body);
    expect(ascending.indexOf(kng.id)).toBeLessThan(ascending.indexOf(twn.id));
    expect(descending.indexOf(twn.id)).toBeLessThan(descending.indexOf(kng.id));
  });

  it("filters an arrival range, including a same-day range, and rejects a reversed one", async () => {
    const day = addDays(D, 20);
    const inRange = await book({ arrival: day, departure: addDays(day, 1) });
    const outside = await book({ arrival: addDays(day, 2), departure: addDays(day, 3) });

    const sameDay = await listReservations(`arrivalFrom=${day}&arrivalTo=${day}&limit=50`);
    expect(ids(sameDay.body)).toContain(inRange.id);
    expect(ids(sameDay.body)).not.toContain(outside.id);

    const startOnly = await listReservations(`arrivalFrom=${addDays(day, 1)}&limit=50`);
    expect(ids(startOnly.body)).toContain(outside.id);
    expect(ids(startOnly.body)).not.toContain(inRange.id);

    const reversed = await listReservations(`arrivalFrom=${addDays(day, 1)}&arrivalTo=${day}`);
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.details.fields.arrivalTo).toBeDefined();
  });

  it("pages a filtered, sorted list without gaps or repeats", async () => {
    const all = ids((await listReservations("q=quartermain&sort=-arrival&limit=100")).body);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listReservations(
        `q=quartermain&sort=-arrival&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(page.status).toBe(200);
      seen.push(...ids(page.body));
      cursor = page.body.meta.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all);
  });

  it("never returns another property's reservations", async () => {
    const atB = await book({ arrival: addDays(D, 5), departure: addDays(D, 6) }, B);
    // B's room type as a filter in A: nothing, and no error that leaks it.
    const foreignType = await listReservations(`roomTypeId=${invB.roomTypes.KNG!.id}&limit=50`);
    expect(foreignType.status).toBe(200);
    expect(ids(foreignType.body)).toEqual([]);
    // B's confirmation number searched in A: not found.
    const foreignSearch = await listReservations(`q=${atB.confirmation}&limit=50`);
    expect(ids(foreignSearch.body)).not.toContain(atB.id);
    // A user of A only cannot list B at all.
    expect((await listReservations("limit=5", fomA, B)).status).toBe(403);
  });
});

describe("confirmation search on front desk and billing", () => {
  let arrival: { id: string; version: number; confirmation: string };

  beforeAll(async () => {
    const room = await prisma.room.findFirstOrThrow({
      where: { propertyId: A, roomTypeId: invA.roomTypes.KNG!.id },
      select: { id: true },
      orderBy: { number: "desc" },
    });
    arrival = await book({ arrival: D, departure: addDays(D, 2), roomId: room.id, adults: 1 });
  });

  const arrivals = (q: string) =>
    call(arrivalsRoute, {
      path: `${base(A)}/front-desk/arrivals?q=${encodeURIComponent(q)}`,
      params: { propertyId: A },
      jar: admin,
    });

  it("finds an arrival by its confirmation number typed in lower case, digits only or with a share suffix", async () => {
    const digits = arrival.confirmation.split("-").at(-1)!;
    for (const typed of [
      arrival.confirmation,
      arrival.confirmation.toLowerCase(),
      digits,
      `${arrival.confirmation}-1`,
    ]) {
      const r = await arrivals(typed);
      expect(r.status, typed).toBe(200);
      expect(
        r.body.data.map((row: { reservationRoomId: string }) => row.reservationRoomId),
        typed,
      ).toContain(arrival.id);
    }
  });

  it("finds the folio the same way once the guest is in house", async () => {
    const r = await call(checkInRoute, {
      method: "POST",
      path: `${base(A)}/reservation-rooms/${arrival.id}/check-in`,
      params: { propertyId: A, reservationRoomId: arrival.id },
      body: { version: arrival.version },
      jar: admin,
    });
    expect(r.status).toBe(201);
    const inHouse = await call(inHouseRoute, {
      path: `${base(A)}/front-desk/in-house?q=${arrival.confirmation.toLowerCase()}`,
      params: { propertyId: A },
      jar: admin,
    });
    expect(inHouse.body.data.length).toBe(1);
    for (const typed of [
      arrival.confirmation.toLowerCase(),
      arrival.confirmation.split("-").at(-1)!,
    ]) {
      const folios = await call(foliosRoute, {
        path: `${base(A)}/folios?view=all&q=${encodeURIComponent(typed)}`,
        params: { propertyId: A },
        jar: admin,
      });
      expect(folios.status, typed).toBe(200);
      expect(
        folios.body.data.map((row: { reservationRoomId: string }) => row.reservationRoomId),
        typed,
      ).toContain(arrival.id);
    }
    // The wildcard characters are matched literally.
    const wildcard = await call(foliosRoute, {
      path: `${base(A)}/folios?view=all&q=%25`,
      params: { propertyId: A },
      jar: admin,
    });
    expect(wildcard.status).toBe(200);
    expect(wildcard.body.data).toEqual([]);
  });
});

describe("company search", () => {
  it("matches a company code that contains an underscore", async () => {
    const code = `ACME_${org.suffix.slice(0, 4)}`;
    const created = await call(createAccountRoute, {
      method: "POST",
      path: "/api/v1/accounts",
      body: { code, name: "Underscore Holdings" },
      jar: admin,
    });
    expect(created.status).toBe(201);
    const found = await call(accountsRoute, {
      path: `/api/v1/accounts?q=${encodeURIComponent(code.toLowerCase())}`,
      jar: admin,
    });
    expect(found.status).toBe(200);
    expect(found.body.data.map((a: { code: string }) => a.code)).toContain(code);
  });
});

describe("housekeeping inspections", () => {
  it("lists every task the Inspections count includes, also one cleaned on an earlier date", async () => {
    const type =
      (await prisma.housekeepingTaskType.findFirst({
        where: { propertyId: A, changesRoomStatus: true, requiresInspection: true },
        select: { id: true },
      })) ??
      (await prisma.housekeepingTaskType.create({
        data: {
          propertyId: A,
          code: "FLTINSP",
          name: "Filter test clean",
          changesRoomStatus: true,
          requiresInspection: true,
        },
        select: { id: true },
      }));
    const room = await prisma.room.findFirstOrThrow({
      where: { propertyId: A, roomTypeId: invA.roomTypes.TWN!.id },
      select: { id: true },
    });
    await prisma.room.update({ where: { id: room.id }, data: { housekeepingStatus: "CLEAN" } });
    const task = await prisma.housekeepingTask.create({
      data: {
        propertyId: A,
        roomId: room.id,
        taskTypeId: type.id,
        businessDate: fromDateOnly(addDays(D, -1)),
        status: "COMPLETED",
        completedAt: new Date(),
      },
      select: { id: true },
    });

    const list = await call(tasksRoute, {
      path: `${base(A)}/housekeeping/tasks?view=inspections&limit=100`,
      params: { propertyId: A },
      jar: admin,
    });
    const summary = await call(hkSummaryRoute, {
      path: `${base(A)}/housekeeping/summary`,
      params: { propertyId: A },
      jar: admin,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { id: string }) => t.id)).toContain(task.id);
    expect(list.body.data.length).toBe(summary.body.data.tasks.awaitingInspection);
  });
});
