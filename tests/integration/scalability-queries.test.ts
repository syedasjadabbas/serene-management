import { beforeAll, describe, expect, it } from "vitest";
import { GET as accountRoute } from "@/app/api/v1/accounts/[accountId]/route";
import { POST as createAccountRoute } from "@/app/api/v1/accounts/route";
import { GET as historyRoute } from "@/app/api/v1/guests/[guestId]/history/route";
import { GET as guestRoute } from "@/app/api/v1/guests/[guestId]/route";
import {
  GET as reservationsRoute,
  POST as createReservationRoute,
} from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { GET as foliosRoute } from "@/app/api/v1/properties/[propertyId]/folios/route";
import { GET as boardRoute } from "@/app/api/v1/properties/[propertyId]/rooms/board/route";
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
 * Queries rewritten in the scalability phase (docs/SCALABILITY.md §15) return the
 * same results as before:
 *  - room counts per reservation (display confirmations) no longer come from a
 *    relation `_count`, which aggregated the whole reservation_rooms table;
 *  - a guest's statistics and history match primary AND sharer reservations
 *    through two index lookups instead of an OR/EXISTS;
 *  - the room board's current housekeeping task uses the live-task index;
 *  - folio search (also a global-search source) unites name, confirmation and
 *    room-number candidates instead of one OR across three tables.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let A: string;
let inv: Inventory;
let D: string;
let gm: CookieJar;

const P = `/api/v1/properties`;

async function book(body: Record<string, unknown>) {
  const r = await call(createReservationRoute, {
    method: "POST",
    path: `${P}/${A}/reservations`,
    params: { propertyId: A },
    body: {
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      ...body,
    },
    jar: gm,
  });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; confirmationNumber: string; rooms: { id: string }[] };
}

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 8 }]);
  D = inv.businessDate;
  const user = await createUser(org, "gm", [{ role: "GENERAL_MANAGER", property: "A" }]);
  gm = await loginAs(user.email, TEST_PASSWORD);
}, 120_000);

describe("room counts per reservation", () => {
  it("shows line numbers only for multi-room reservations in the list and company history", async () => {
    const guest = (await createGuestRow(org, "Multi", "Rooms")).id;
    const company = await call(createAccountRoute, {
      method: "POST",
      path: "/api/v1/accounts",
      body: { code: `SC${org.suffix.slice(0, 6)}`, name: "Scale Co" },
      jar: gm,
    });
    expect(company.status).toBe(201);
    const companyId = company.body.data.id as string;
    const multi = await book({
      guestId: guest,
      rooms: 2,
      arrival: addDays(D, 3),
      departure: addDays(D, 5),
      companyId,
    });
    const single = await book({ guestId: guest, arrival: addDays(D, 3), departure: addDays(D, 4) });

    const list = await call(reservationsRoute, {
      path: `${P}/${A}/reservations?limit=200`,
      params: { propertyId: A },
      jar: gm,
    });
    expect(list.status).toBe(200);
    const shown = (reservationId: string) =>
      list.body.data
        .filter((r: { reservationId: string }) => r.reservationId === reservationId)
        .map((r: { displayConfirmation: string }) => r.displayConfirmation)
        .sort();
    expect(shown(multi.id)).toEqual([
      `${multi.confirmationNumber}-1`,
      `${multi.confirmationNumber}-2`,
    ]);
    expect(shown(single.id)).toEqual([single.confirmationNumber]);

    const account = await call(accountRoute, {
      path: `/api/v1/accounts/${companyId}`,
      params: { accountId: companyId },
      jar: gm,
    });
    expect(account.status).toBe(200);
    expect(
      account.body.data.reservations.map((r: { confirmation: string }) => r.confirmation).sort(),
    ).toEqual([`${multi.confirmationNumber}-1`, `${multi.confirmationNumber}-2`]);
  });
});

describe("guest statistics and history", () => {
  it("count reservations where the guest is primary or a sharer, and nothing else", async () => {
    const primary = (await createGuestRow(org, "Prima", "Booker")).id;
    const sharer = (await createGuestRow(org, "Shari", "Roommate")).id;
    const stranger = (await createGuestRow(org, "Stran", "Nobody")).id;
    const reservation = await book({
      guestId: primary,
      arrival: addDays(D, 10),
      departure: addDays(D, 12),
    });
    await book({ guestId: primary, arrival: addDays(D, 20), departure: addDays(D, 21) });
    const room = await prisma.reservationRoom.findFirstOrThrow({
      where: { reservationId: reservation.id },
      select: { id: true },
    });
    await prisma.reservationGuest.create({
      data: { reservationRoomId: room.id, guestId: sharer, isPrimary: false, sequence: 2 },
    });

    const statistics = async (guestId: string) =>
      (await call(guestRoute, { path: `/api/v1/guests/${guestId}`, params: { guestId }, jar: gm }))
        .body.data.statistics;
    const history = async (guestId: string) =>
      (
        await call(historyRoute, {
          path: `/api/v1/guests/${guestId}/history`,
          params: { guestId },
          jar: gm,
        })
      ).body.data as { reservationRoomId: string; isPrimaryGuest: boolean }[];

    expect((await statistics(primary)).upcoming).toBe(2);
    expect((await statistics(sharer)).upcoming).toBe(1);
    expect((await statistics(stranger)).upcoming).toBe(0);

    const shared = await history(sharer);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ reservationRoomId: room.id, isPrimaryGuest: false });
    expect(await history(primary)).toHaveLength(2);
    expect(await history(stranger)).toHaveLength(0);
  });
});

describe("room board housekeeping task", () => {
  it("shows the room's live task and ignores inspected history", async () => {
    const type =
      (await prisma.housekeepingTaskType.findFirst({
        where: { propertyId: A, changesRoomStatus: true },
        select: { id: true },
      })) ??
      (await prisma.housekeepingTaskType.create({
        data: { propertyId: A, code: "SCLDEP", name: "Departure clean", changesRoomStatus: true },
        select: { id: true },
      }));
    const [live, history] = await prisma.room.findMany({
      where: { propertyId: A },
      orderBy: { number: "asc" },
      take: 2,
      select: { id: true },
    });
    const pending = await prisma.housekeepingTask.create({
      data: {
        propertyId: A,
        roomId: live!.id,
        taskTypeId: type.id,
        businessDate: fromDateOnly(D),
        status: "PENDING",
      },
      select: { id: true },
    });
    // Two days of inspected history on the other room: never shown as its current task.
    for (const days of [-2, -1]) {
      const done = new Date();
      await prisma.housekeepingTask.create({
        data: {
          propertyId: A,
          roomId: history!.id,
          taskTypeId: type.id,
          businessDate: fromDateOnly(addDays(D, days)),
          status: "INSPECTED",
          completedAt: done,
          inspectedAt: done,
          inspectedById: org.adminId,
        },
      });
    }

    const board = await call(boardRoute, {
      path: `${P}/${A}/rooms/board`,
      params: { propertyId: A },
      jar: gm,
    });
    expect(board.status).toBe(200);
    // Load-test timings are opt-in (SERVER_TIMING=1): never sent by default.
    expect(board.response.headers.get("server-timing")).toBeNull();
    const task = (roomId: string) =>
      board.body.data.items.find((r: { id: string }) => r.id === roomId)?.task ?? null;
    expect(task(live!.id)).toMatchObject({ id: pending.id, status: "PENDING" });
    expect(task(history!.id)).toBeNull();
  });
});

describe("folio search", () => {
  it("matches guest name words, the room number and the confirmation, nothing else", async () => {
    const guest = (await createGuestRow(org, "Folio", "Searchable")).id;
    const other = (await createGuestRow(org, "Other", "Person")).id;
    const room = await prisma.room.findFirstOrThrow({
      where: { propertyId: A },
      orderBy: { number: "desc" },
      select: { id: true, number: true },
    });
    const mine = await book({
      guestId: guest,
      roomId: room.id,
      arrival: addDays(D, 30),
      departure: addDays(D, 31),
    });
    const theirs = await book({
      guestId: other,
      arrival: addDays(D, 30),
      departure: addDays(D, 31),
    });
    for (const reservation of [mine, theirs]) {
      const rr = await prisma.reservationRoom.findFirstOrThrow({
        where: { reservationId: reservation.id },
        select: { id: true },
      });
      await prisma.folio.create({
        data: {
          propertyId: A,
          ownerType: "GUEST",
          reservationRoomId: rr.id,
          currencyCode: org.properties.A!.currencyCode,
          openedById: org.adminId,
        },
      });
    }
    const mineRoom = await prisma.reservationRoom.findFirstOrThrow({
      where: { reservationId: mine.id },
      select: { id: true },
    });
    const found = async (q: string) =>
      (
        await call(foliosRoute, {
          path: `${P}/${A}/folios?view=all&limit=50&q=${encodeURIComponent(q)}`,
          params: { propertyId: A },
          jar: gm,
        })
      ).body.data.map((r: { reservationRoomId: string }) => r.reservationRoomId) as string[];

    expect(await found("searchable")).toEqual([mineRoom.id]);
    expect(await found("searchable folio")).toEqual([mineRoom.id]);
    expect(await found("searchable nobody")).toEqual([]);
    expect(await found(room.number)).toContain(mineRoom.id);
    expect(await found(mine.confirmationNumber)).toEqual([mineRoom.id]);
  });
});
