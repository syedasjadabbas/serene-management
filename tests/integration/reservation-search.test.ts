import { beforeAll, describe, expect, it } from "vitest";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as cancelRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/cancel/route";
import {
  GET as listRoute,
  POST as createRoute,
} from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/modules/business-date/business-date.policy";
import { guestSearchName, normalizeName } from "@/modules/guests/guests.policy";
import { parseConfirmationNumber } from "@/modules/properties/confirmation-number.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createCustomUser,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";
import { countStatements } from "./support/statements";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import {
  bookingState,
  displayConfirmation,
  nightCount,
} from "@/modules/reservations/reservations.policy";

/**
 * Reservation text search (docs/SCALABILITY.md §29): the search runs as one
 * query per kind of match (confirmation, cancellation number, external
 * reference, room, guest name) and cuts the page from their union. Every
 * result must equal the former single query ("filters AND (any match)"),
 * reproduced here as an oracle, for every sort, filter, page size and page.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let other: FixtureOrg;
let A: string;
let B: string;
let X: string;
let invA: Inventory;
let invB: Inventory;
let invX: Inventory;
let D: string;
let admin: CookieJar;
const P = (propertyId: string) => `/api/v1/properties/${propertyId}`;

interface Booked {
  id: string;
  version: number;
  reservationId: string;
  confirmation: string;
}

async function book(
  propertyId: string,
  inv: Inventory,
  jar: CookieJar,
  guestId: string,
  overrides: Record<string, unknown> = {},
): Promise<Booked> {
  const r = await call(createRoute, {
    method: "POST",
    path: `${P(propertyId)}/reservations`,
    params: { propertyId },
    body: {
      arrival: addDays(inv.businessDate, 3),
      departure: addDays(inv.businessDate, 5),
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
      ...overrides,
    },
    jar,
  });
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  const room = r.body.data.rooms[0] as { id: string; version: number };
  return {
    ...room,
    reservationId: r.body.data.id as string,
    confirmation: r.body.data.confirmationNumber as string,
  };
}

function list(query: string, jar = admin, propertyId = A) {
  return call(listRoute, {
    path: `${P(propertyId)}/reservations?${query}`,
    params: { propertyId },
    jar,
  });
}
const ids = (body: { data: { reservationRoomId: string }[] }) =>
  body.data.map((row) => row.reservationRoomId);

/** The former query: one findMany on "property AND filters AND (any match)". */
async function oracle(
  propertyId: string,
  q: string,
  extra: Prisma.ReservationRoomWhereInput[],
  sort: "arrival" | "-arrival" | "-created",
  take: number,
): Promise<string[]> {
  const raw = q.trim();
  const parsed = parseConfirmationNumber(raw);
  const confirmation: Prisma.ReservationRoomWhereInput[] = !parsed
    ? [{ reservation: { confirmationNumber: { startsWith: raw.toUpperCase() } } }]
    : parsed.prefix
      ? [
          {
            reservation: {
              confirmationNumber: { startsWith: `${parsed.prefix}-${parsed.number}` },
            },
          },
        ]
      : [
          { reservation: { confirmationNumber: { startsWith: parsed.number } } },
          { reservation: { confirmationNumber: { contains: `-${parsed.number}` } } },
        ];
  const tokens = normalizeName(raw).split(" ").filter(Boolean).slice(0, 5);
  const [field, direction] =
    sort === "arrival"
      ? (["arrivalDate", "asc"] as const)
      : sort === "-arrival"
        ? (["arrivalDate", "desc"] as const)
        : (["createdAt", "desc"] as const);
  const rows = await prisma.reservationRoom.findMany({
    where: {
      AND: [
        { propertyId },
        ...extra,
        {
          OR: [
            ...confirmation,
            { cancellationNumber: raw.toUpperCase() },
            { reservation: { externalReference: raw } },
            { room: { number: raw } },
            ...(tokens.length
              ? [{ AND: tokens.map((t) => ({ primaryGuest: { searchName: { contains: t } } })) }]
              : []),
          ],
        },
      ],
    },
    orderBy: [{ [field]: direction }, { id: direction }],
    take,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

let cancelled: Booked;
let external: Booked;
let roomBooked: Booked;
let multiRoom: Booked;
let atB: Booked;
let atX: Booked;
const EXTERNAL = "OTA-Ref-77Q";

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  X = other.properties.X!.id;
  invA = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 10 }]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 4 }]);
  invX = await buildFixtureInventory(other, "X", [{ code: "KNG", rooms: 4 }]);
  D = invA.businessDate;
  await prisma.room.updateMany({
    where: { propertyId: { in: [A, B, X] } },
    data: { frontOfficeStatus: "VACANT", housekeepingStatus: "CLEAN" },
  });
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
  const otherAdmin = await loginAs(
    `admin.${other.suffix.toLowerCase()}@serene.test`,
    TEST_PASSWORD,
  );

  // Names: a rare pair of common words, and a surname shared by more guests
  // than the id lookup takes (so both name strategies run).
  const orla = (await createGuestRow(org, "Orla", "Pemberton")).id;
  const pem2 = (await createGuestRow(org, "Idris", "Pemberton")).id;
  const vance = (await createGuestRow(org, "Una", "Vance")).id;
  await prisma.guest.createMany({
    data: Array.from({ length: 520 }, (_, i) => ({
      organizationId: org.organizationId,
      profileNumber: `M${org.suffix}${String(i).padStart(4, "0")}`.slice(0, 20),
      firstName: `Many${i}`,
      lastName: "Multitude",
      searchName: guestSearchName(`Many${i}`, "Multitude"),
    })),
  });
  const multitude = await prisma.guest.findMany({
    where: { organizationId: org.organizationId, lastName: "Multitude" },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 6,
  });

  for (let i = 0; i < 4; i++) {
    await book(A, invA, admin, i % 2 ? orla : pem2, {
      arrival: addDays(D, 2 + i),
      departure: addDays(D, 3 + i),
    });
  }
  await book(A, invA, admin, vance);
  for (const [i, g] of multitude.entries()) {
    await book(A, invA, admin, g.id, { arrival: addDays(D, 1 + i), departure: addDays(D, 2 + i) });
  }
  external = await book(A, invA, admin, vance, { externalReference: EXTERNAL });
  roomBooked = await book(A, invA, admin, orla, {
    roomId: invA.roomTypes.KNG!.roomIds[4],
    arrival: addDays(D, 9),
    departure: addDays(D, 10),
  });
  multiRoom = await book(A, invA, admin, pem2, {
    rooms: 2,
    arrival: addDays(D, 12),
    departure: addDays(D, 13),
  });
  const toCancel = await book(A, invA, admin, vance, {
    arrival: addDays(D, 14),
    departure: addDays(D, 15),
  });
  const c = await call(cancelRoute, {
    method: "POST",
    path: `${P(A)}/reservation-rooms/${toCancel.id}/cancel`,
    params: { propertyId: A, reservationRoomId: toCancel.id },
    body: {
      version: toCancel.version,
      reasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"],
      reason: "Guest cancelled",
    },
    jar: admin,
  });
  expect(c.status).toBe(200);
  cancelled = toCancel;
  atB = await book(B, invB, admin, orla, { externalReference: EXTERNAL });
  const namesake = (await createGuestRow(other, "Orla", "Pemberton")).id;
  atX = await book(X, invX, otherAdmin, namesake, { externalReference: EXTERNAL });
}, 240_000);

const cancellationNumber = async () =>
  (
    await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: cancelled.id },
      select: { cancellationNumber: true },
    })
  ).cancellationNumber!;

describe("reservation search: each kind of match", () => {
  it("finds by confirmation (full, prefixed digits, bare digits), cancellation number, external reference, room and name", async () => {
    const find = async (q: string) => ids((await list(`q=${encodeURIComponent(q)}&limit=50`)).body);
    expect(await find(external.confirmation)).toContain(external.id);
    expect(await find(external.confirmation.toLowerCase())).toContain(external.id);
    const digits = external.confirmation.split("-").at(-1)!;
    expect(await find(digits)).toContain(external.id);
    const multi = await find(multiRoom.confirmation);
    expect(multi).toContain(multiRoom.id);
    expect(multi).toHaveLength(2); // both rooms of the booking

    const cxl = await cancellationNumber();
    expect(await find(cxl)).toEqual([cancelled.id]);
    expect(await find(cxl.toLowerCase())).toEqual([cancelled.id]);

    expect(await find(EXTERNAL)).toEqual([external.id]);
    expect(await find(EXTERNAL.toUpperCase())).toEqual([]); // exact, as before

    const roomNumber = invA.roomTypes.KNG!.roomNumbers[4]!;
    expect(await find(roomNumber)).toContain(roomBooked.id);

    const pair = await find("pemberton orla");
    expect(pair.length).toBeGreaterThan(0);
    expect(await find("zzqxv")).toEqual([]);
    expect(await find("zz")).toEqual([]);
  });

  it("returns exactly the former query's rows for every sort, filter, page size and page", async () => {
    const cxl = await cancellationNumber();
    const terms = [
      "orla",
      "pemberton",
      "orla pemberton",
      "PEMBERTON ORLA",
      "vance",
      "multitude",
      "many1 multitude",
      "zzqxv",
      "zz",
      "or",
      "10",
      EXTERNAL,
      cxl,
      cxl.toLowerCase(),
      external.confirmation,
      external.confirmation.split("-").at(-1)!,
      multiRoom.confirmation.slice(0, 6),
      invA.roomTypes.KNG!.roomNumbers[4]!,
      "999",
    ];
    const filters: [string, Prisma.ReservationRoomWhereInput[]][] = [
      ["", []],
      ["&state=CANCELLED", [{ status: "CANCELLED" }]],
      [
        `&arrivalFrom=${addDays(D, 3)}&arrivalTo=${addDays(D, 8)}`,
        [
          {
            arrivalDate: {
              gte: new Date(`${addDays(D, 3)}T00:00:00Z`),
              lte: new Date(`${addDays(D, 8)}T00:00:00Z`),
            },
          },
        ],
      ],
      [`&roomTypeId=${invA.roomTypes.KNG!.id}`, [{ roomTypeId: invA.roomTypes.KNG!.id }]],
    ];
    let compared = 0;
    for (const q of terms)
      for (const [qs, where] of filters)
        for (const sort of ["arrival", "-arrival", "-created"] as const)
          for (const limit of [2, 5, 50]) {
            // Walk every page and compare with the oracle's full ordered list.
            const expected = await oracle(A, q, where, sort, 500);
            const seen: string[] = [];
            let cursor: string | null = null;
            let pages = 0;
            do {
              const r = await list(
                `q=${encodeURIComponent(q)}${qs}&sort=${sort}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
              );
              expect(r.status).toBe(200);
              expect(r.body.data.length).toBeLessThanOrEqual(limit);
              seen.push(...ids(r.body));
              cursor = r.body.meta.nextCursor;
              pages += 1;
            } while (cursor && pages < 40);
            expect(seen, `q=${q}${qs} sort=${sort} limit=${limit}`).toEqual(expected);
            compared += 1;
          }
    expect(compared).toBe(terms.length * filters.length * 3 * 3);
  }, 240_000);
});

/**
 * The list page as the former code built it: relation selects, the totals
 * aggregate and the currency lookup, mapped the same way (docs/SCALABILITY.md
 * §30). The one-statement page must return exactly these items.
 */
async function formerItems(propertyId: string, ids: string[], currencyCode: string) {
  const rows = await prisma.reservationRoom.findMany({
    where: { propertyId, id: { in: ids } },
    select: {
      id: true,
      reservationId: true,
      lineNumber: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      adults: true,
      children: true,
      currencyCode: true,
      reservationType: { select: { deductsInventory: true } },
      reservation: {
        select: {
          confirmationNumber: true,
          bookedAt: true,
          channel: { select: { code: true } },
          rooms: { select: { id: true } },
        },
      },
      primaryGuest: { select: { id: true, firstName: true, lastName: true, vipLevelId: true } },
      roomType: { select: { code: true, name: true } },
      room: { select: { number: true } },
      ratePlan: { select: { code: true } },
      sourceCode: { select: { code: true } },
    },
  });
  const sums = await prisma.reservationRoomNight.groupBy({
    by: ["reservationRoomId"],
    where: { reservationRoomId: { in: ids } },
    _sum: { rateAmount: true },
  });
  const totals = new Map(sums.map((r) => [r.reservationRoomId, r._sum.rateAmount?.toFixed(4)]));
  const minorUnits =
    (await prisma.currency.findUnique({ where: { code: currencyCode } }))?.minorUnits ?? 2;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id)!;
    const arrival = toDateOnly(row.arrivalDate);
    const departure = toDateOnly(row.departureDate);
    return {
      reservationId: row.reservationId,
      reservationRoomId: row.id,
      confirmationNumber: row.reservation.confirmationNumber,
      displayConfirmation: displayConfirmation(
        row.reservation.confirmationNumber,
        row.lineNumber,
        row.reservation.rooms.length,
      ),
      lineNumber: row.lineNumber,
      status: row.status,
      bookingState: bookingState(row.status, row.reservationType.deductsInventory),
      guest: {
        id: row.primaryGuest.id,
        name: [row.primaryGuest.lastName, row.primaryGuest.firstName].join(", "),
        isVip: row.primaryGuest.vipLevelId !== null,
      },
      arrival,
      departure,
      nights: nightCount(arrival, departure),
      adults: row.adults,
      children: row.children,
      roomType: row.roomType,
      room: row.room,
      ratePlan: row.ratePlan,
      source: row.sourceCode,
      channel: row.reservation.channel,
      currencyCode: row.currencyCode,
      totalAmount: formatMoney(parseMoney(totals.get(row.id) ?? "0"), minorUnits),
      bookedAt: row.reservation.bookedAt.toISOString(),
    };
  });
}

describe("reservation list page loading", () => {
  it("returns exactly the former items (fields, order, nulls, totals) for lists and searches", async () => {
    const currency = org.properties.A!.currencyCode;
    let pages = 0;
    for (const q of ["", "orla", "pemberton", multiRoom.confirmation, EXTERNAL, "zzqxv"])
      for (const extra of ["", "&state=CANCELLED", `&arrivalFrom=${addDays(D, 3)}`])
        for (const sort of ["arrival", "-arrival", "-created"])
          for (const limit of [3, 50]) {
            let cursor: string | null = null;
            do {
              const r = await list(
                `${q ? `q=${encodeURIComponent(q)}&` : ""}sort=${sort}&limit=${limit}${extra}${cursor ? `&cursor=${cursor}` : ""}`,
              );
              expect(r.status).toBe(200);
              const expected = await formerItems(A, ids(r.body), currency);
              expect(JSON.stringify(r.body.data)).toBe(JSON.stringify(expected));
              cursor = r.body.meta.nextCursor;
              pages += 1;
            } while (cursor);
          }
    expect(pages).toBeGreaterThan(108);
    // The fixture covers a room assigned and not, a multi-room booking and a cancellation.
    const all = (await list("limit=100")).body.data as {
      room: unknown;
      displayConfirmation: string;
      confirmationNumber: string;
      status: string;
    }[];
    expect(all.some((r) => r.room === null)).toBe(true);
    expect(all.some((r) => r.room !== null)).toBe(true);
    expect(all.some((r) => r.displayConfirmation !== r.confirmationNumber)).toBe(true);
    expect(all.some((r) => r.status === "CANCELLED")).toBe(true);
  }, 240_000);

  it("loads a page in one statement after selecting it", async () => {
    await list("limit=50"); // warm-up
    const plain = await countStatements(() => list("limit=50"));
    expect(plain.result.status).toBe(200);
    // Authentication (1), the page's keys (1), the page with every list field (1).
    // Was 13: nine relation loads, the totals and the currency followed the page.
    expect(plain.statements).toBe(3);
    const empty = await countStatements(() => list("q=zzqxv&limit=50"));
    expect(empty.result.body.data).toEqual([]);
    expect(empty.texts.some((t) => /"currencies"/.test(t))).toBe(false);
  });
});

describe("reservation search: isolation and access", () => {
  it("never returns another property's or organization's reservations", async () => {
    const cxl = await cancellationNumber();
    for (const q of [atB.confirmation, atX.confirmation, EXTERNAL, "orla pemberton", cxl]) {
      const found = ids((await list(`q=${encodeURIComponent(q)}&limit=50`)).body);
      expect(found).not.toContain(atB.id);
      expect(found).not.toContain(atX.id);
    }
    const inB = ids((await list(`q=${EXTERNAL}&limit=50`, admin, B)).body);
    expect(inB).toEqual([atB.id]);
    // Another organization's property: refused like a missing one.
    expect((await list(`q=${EXTERNAL}`, admin, X)).status).toBe(403);
  });

  it("applies the route permission and property access for single-, multi-property and organization users", async () => {
    const single = await loginAs(
      (await createUser(org, "rs-single", [{ role: "FRONT_DESK_AGENT", property: "A" }])).email,
      TEST_PASSWORD,
    );
    expect(
      (await list(`q=${EXTERNAL}`, single)).body.data.map(
        (r: { reservationRoomId: string }) => r.reservationRoomId,
      ),
    ).toEqual([external.id]);
    expect((await list(`q=${EXTERNAL}`, single, B)).status).toBe(403);

    const multi = await loginAs(
      (
        await createUser(org, "rs-multi", [
          { role: "FRONT_OFFICE_MANAGER", property: "A" },
          { role: "FRONT_OFFICE_MANAGER", property: "B" },
        ])
      ).email,
      TEST_PASSWORD,
    );
    expect(ids((await list(`q=${EXTERNAL}`, multi, A)).body)).toEqual([external.id]);
    expect(ids((await list(`q=${EXTERNAL}`, multi, B)).body)).toEqual([atB.id]);

    const orgWide = await loginAs(
      (await createUser(org, "rs-org", [{ role: "GENERAL_MANAGER" }])).email,
      TEST_PASSWORD,
    );
    expect(ids((await list(`q=${EXTERNAL}`, orgWide, B)).body)).toEqual([atB.id]);

    const noRead = await loginAs(
      (await createCustomUser(org, "rs-noread", [{ permissions: ["guests:read"], property: "A" }]))
        .email,
      TEST_PASSWORD,
    );
    expect((await list(`q=${EXTERNAL}`, noRead)).status).toBe(403);
  });

  it("refuses anonymous, revoked and disabled sessions", async () => {
    expect(
      (await call(listRoute, { path: `${P(A)}/reservations?q=orla`, params: { propertyId: A } }))
        .status,
    ).toBe(401);
    const user = await createUser(org, "rs-revoked", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const jar = await loginAs(user.email, TEST_PASSWORD);
    const cookie = jar.header();
    expect((await list("q=orla", jar)).status).toBe(200);
    await call(logoutRoute, { method: "POST", path: "/api/v1/auth/logout", jar });
    const replay = await call(listRoute, {
      path: `${P(A)}/reservations?q=orla`,
      params: { propertyId: A },
      headers: { cookie },
    });
    expect(replay.status).toBe(401);

    const disabledUser = await createUser(org, "rs-disabled", [
      { role: "FRONT_DESK_AGENT", property: "A" },
    ]);
    const disabled = await loginAs(disabledUser.email, TEST_PASSWORD);
    expect((await list("q=orla", disabled)).status).toBe(200);
    await prisma.user.update({ where: { id: disabledUser.id }, data: { status: "DISABLED" } });
    expect((await list("q=orla", disabled)).status).toBe(401);
  });

  it("refuses an inactive property", async () => {
    await prisma.property.update({ where: { id: B }, data: { status: "INACTIVE" } });
    try {
      expect((await list(`q=${EXTERNAL}`, admin, B)).status).toBe(403);
    } finally {
      await prisma.property.update({ where: { id: B }, data: { status: "ACTIVE" } });
    }
  });
});
