import { beforeAll, describe, expect, it } from "vitest";
import { GET as accountsRoute, POST as createAccountRoute } from "@/app/api/v1/accounts/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { GET as guestSearchRoute } from "@/app/api/v1/guests/route";
import { GET as foliosRoute } from "@/app/api/v1/properties/[propertyId]/folios/route";
import {
  GET as groupsRoute,
  POST as createGroupRoute,
} from "@/app/api/v1/properties/[propertyId]/groups/route";
import {
  GET as maintenanceRoute,
  POST as createRequestRoute,
} from "@/app/api/v1/properties/[propertyId]/maintenance/route";
import {
  GET as reservationsRoute,
  POST as createReservationRoute,
} from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { GET as propertySearchRoute } from "@/app/api/v1/properties/[propertyId]/search/route";
import { GET as organizationSearchRoute } from "@/app/api/v1/search/route";
import { prisma } from "@/lib/db/prisma";
import type { Permission } from "@/lib/permissions/catalog";
import {
  SEARCH_LIMIT_PER_TYPE,
  SEARCH_LIMIT_TOTAL,
  SEARCH_RESULT_TYPES,
  searchResultRoute,
} from "@/modules/search/search.policy";
import type { GlobalSearchResult, SearchHitView } from "@/modules/search/search.types";
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

/**
 * Unified global search (docs/SCALABILITY.md §28): one request returns every
 * type the user may search, each checked on the server with the same
 * permission, scope and query as its own list endpoint. Organization A/B,
 * another organization X.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let other: FixtureOrg;
let A: string;
let B: string;
let invA: Inventory;
let invB: Inventory;
let invX: Inventory;
let admin: CookieJar;
let outsider: CookieJar;
const TERM = "zephyrine";

const P = (propertyId: string) => `/api/v1/properties/${propertyId}`;

function search(jar: CookieJar, q: string, propertyId?: string) {
  const query = new URLSearchParams({ q }).toString();
  return propertyId
    ? call<{ data: GlobalSearchResult }>(propertySearchRoute, {
        path: `${P(propertyId)}/search?${query}`,
        params: { propertyId },
        jar,
      })
    : call<{ data: GlobalSearchResult }>(organizationSearchRoute, {
        path: `/api/v1/search?${query}`,
        jar,
      });
}

const typesOf = (result: GlobalSearchResult) => result.groups.map((g) => g.type);
const hitsOf = (result: GlobalSearchResult, type: SearchHitView["type"]) =>
  result.groups.find((g) => g.type === type)?.hits ?? [];

async function customSession(
  localPart: string,
  grants: { permissions: Permission[]; property?: string }[],
) {
  const user = await createCustomUser(org, localPart, grants);
  return loginAs(user.email, TEST_PASSWORD);
}

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai", currencyCode: "AED" },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  invA = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 6 }]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 4, oneAdult: "450" }]);
  invX = await buildFixtureInventory(other, "X", [{ code: "KNG", rooms: 3 }]);
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
  const otherAdmin = await loginAs(
    `admin.${other.suffix.toLowerCase()}@serene.test`,
    TEST_PASSWORD,
  );
  outsider = await loginAs(
    (await createUser(other, "gmx", [{ role: "GENERAL_MANAGER", property: "X" }])).email,
    TEST_PASSWORD,
  );

  // Seven matching guests (more than one page per type), each booked at A;
  // the first also at B. The other organization has a namesake.
  const guests: string[] = [];
  for (const firstName of ["Ada", "Bea", "Cyd", "Dov", "Eli", "Fay", "Gus"]) {
    guests.push((await createGuestRow(org, firstName, "Zephyrine")).id);
  }
  // `roomId`: assigned and checked in, which opens the stay's folio.
  const stay = async (
    propertyId: string,
    inv: Inventory,
    jar: CookieJar,
    guestId: string,
    roomId?: string,
  ) => {
    const r = await call(createReservationRoute, {
      method: "POST",
      path: `${P(propertyId)}/reservations`,
      params: { propertyId },
      body: {
        arrival: inv.businessDate,
        departure: nextDay(inv.businessDate),
        adults: 1,
        roomTypeId: inv.roomTypes.KNG!.id,
        ratePlanId: inv.ratePlans.BAR!,
        reservationTypeId: inv.reservationTypes.GTD!,
        guestId,
        ...(roomId ? { roomId } : {}),
      },
      jar,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    if (!roomId) return;
    const room = r.body.data.rooms[0] as { id: string; version: number };
    const checkedIn = await call(checkInRoute, {
      method: "POST",
      path: `${P(propertyId)}/reservation-rooms/${room.id}/check-in`,
      params: { propertyId, reservationRoomId: room.id },
      body: { version: room.version },
      jar,
    });
    expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(201);
  };
  // Clean rooms (the builder makes every fourth room dirty): 102, 103.
  const cleanA = invA.roomTypes.KNG!.roomIds;
  for (const [index, guestId] of guests.slice(0, 6).entries()) {
    await stay(A, invA, admin, guestId, index < 2 ? cleanA[index + 1] : undefined);
  }
  await stay(B, invB, admin, guests[0]!, invB.roomTypes.KNG!.roomIds[1]);
  const outsiderGuest = (await createGuestRow(other, "Otto", "Zephyrine")).id;
  await stay(other.properties.X!.id, invX, otherAdmin, outsiderGuest);

  const account = await call(createAccountRoute, {
    method: "POST",
    path: "/api/v1/accounts",
    body: { code: `ZP${org.suffix.slice(0, 6)}`, name: "Zephyrine Holdings" },
    jar: admin,
  });
  expect(account.status).toBe(201);
  const group = await call(createGroupRoute, {
    method: "POST",
    path: `${P(A)}/groups`,
    params: { propertyId: A },
    body: { code: `ZG${org.suffix.slice(0, 6)}`, name: "Zephyrine Wedding" },
    jar: admin,
  });
  expect(group.status).toBe(201);
  const request = await call(createRequestRoute, {
    method: "POST",
    path: `${P(A)}/maintenance`,
    params: { propertyId: A },
    body: {
      categoryId: Object.values(invA.maintenanceCategories)[0]!,
      title: "Zephyrine fan rattles",
      roomId: invA.roomTypes.KNG!.roomIds[5]!,
    },
    jar: admin,
  });
  expect(request.status, JSON.stringify(request.body)).toBe(201);
}, 180_000);

function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("unified global search: one request", () => {
  it("returns every permitted type in one response, in the fixed order, within the limits", async () => {
    const r = await search(admin, TERM, A);
    expect(r.status).toBe(200);
    const result = r.body.data;
    expect(result.query).toBe(TERM);
    expect(typesOf(result)).toEqual([
      "reservations",
      "guests",
      "folios",
      "companies",
      "groups",
      "maintenance",
    ]);
    const order = typesOf(result).map((t) => SEARCH_RESULT_TYPES.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const group of result.groups) {
      expect(group.hits.length).toBeGreaterThan(0);
      expect(group.hits.length).toBeLessThanOrEqual(SEARCH_LIMIT_PER_TYPE);
    }
    const total = result.groups.reduce((n, g) => n + g.hits.length, 0);
    expect(total).toBeLessThanOrEqual(SEARCH_LIMIT_TOTAL);
    // Seven guests match: the page stops at the per-type limit.
    expect(hitsOf(result, "guests")).toHaveLength(SEARCH_LIMIT_PER_TYPE);
    // Deterministic: the same request gives the same response.
    expect((await search(admin, TERM, A)).body.data).toEqual(result);
  });

  it("returns the same records as the per-type endpoints it replaces", async () => {
    const result = (await search(admin, TERM, A)).body.data;
    const q = (extra: Record<string, string> = {}) =>
      new URLSearchParams({ q: TERM, limit: "5", ...extra }).toString();
    const ids = async (
      route: Parameters<typeof call>[0],
      path: string,
      pick: (row: Record<string, string>) => string,
      params: Record<string, string> = { propertyId: A },
    ) => {
      const r = await call(route, { path, params, jar: admin });
      expect(r.status).toBe(200);
      return (r.body.data as Record<string, string>[]).map(pick);
    };
    const same = async (type: SearchHitView["type"], expected: Promise<string[]>) =>
      expect(hitsOf(result, type).map((h) => h.id)).toEqual(await expected);
    await same(
      "reservations",
      ids(reservationsRoute, `${P(A)}/reservations?${q()}`, (r) => r.reservationRoomId!),
    );
    await same(
      "guests",
      ids(guestSearchRoute, `/api/v1/guests?${q()}`, (r) => r.id!, {}),
    );
    await same(
      "folios",
      ids(foliosRoute, `${P(A)}/folios?${q({ view: "all" })}`, (r) => r.reservationRoomId!),
    );
    await same(
      "companies",
      ids(accountsRoute, `/api/v1/accounts?${q()}`, (r) => r.id!, {}),
    );
    await same(
      "groups",
      ids(groupsRoute, `${P(A)}/groups?${q()}`, (r) => r.id!),
    );
    await same(
      "maintenance",
      ids(maintenanceRoute, `${P(A)}/maintenance?${q({ view: "all" })}`, (r) => r.id!),
    );
  });

  it("costs fewer database statements than the six requests it replaces", async () => {
    await search(admin, TERM, A); // warm-up
    const unified = await countStatements(() => search(admin, TERM, A));
    const q = new URLSearchParams({ q: TERM, limit: "5" }).toString();
    const qa = new URLSearchParams({ q: TERM, limit: "5", view: "all" }).toString();
    const params = { propertyId: A };
    const before = await countStatements(async () => {
      await call(reservationsRoute, { path: `${P(A)}/reservations?${q}`, params, jar: admin });
      await call(guestSearchRoute, { path: `/api/v1/guests?${q}`, jar: admin });
      await call(foliosRoute, { path: `${P(A)}/folios?${qa}`, params, jar: admin });
      await call(accountsRoute, { path: `/api/v1/accounts?${q}`, jar: admin });
      await call(groupsRoute, { path: `${P(A)}/groups?${q}`, params, jar: admin });
      await call(maintenanceRoute, { path: `${P(A)}/maintenance?${qa}`, params, jar: admin });
    });
    // One authentication instead of six (-5); the same searches; plus one
    // statement each for rooms and rate plans, which the palette used to load
    // with three requests (picker, board, rate plans) whenever it opened.
    expect(unified.statements).toBeLessThanOrEqual(before.statements - 5 + 2);
    expect(unified.texts.filter((t) => /FROM "auth_sessions"/.test(t))).toHaveLength(1);
  });

  it("normalizes every hit and builds its route from the type, never from the response", async () => {
    const result = (await search(admin, TERM, A)).body.data;
    for (const group of result.groups) {
      for (const hit of group.hits) {
        expect(Object.keys(hit).sort()).toEqual(
          [
            "id",
            "meta",
            "propertyCode",
            "subtitle",
            "targetId",
            "title",
            "type",
            "vip",
            ...(hit.type === "rooms" ? ["roomView"] : []),
          ].sort(),
        );
        expect(hit.type).toBe(group.type);
        expect(hit.propertyCode).toBe(org.properties.A!.code);
        expect(searchResultRoute(hit)).toMatch(new RegExp(`^/${org.properties.A!.code}/`));
      }
    }
    const reservation = hitsOf(result, "reservations")[0]!;
    expect(reservation.title).toMatch(/^#/);
    expect(searchResultRoute(reservation)).toBe(
      `/${org.properties.A!.code}/reservations/${reservation.targetId}`,
    );
    const folio = hitsOf(result, "folios")[0]!;
    expect(folio.meta).toMatch(/^PKR -?[\d,]+\.\d{2}$/);
    expect(searchResultRoute(folio)).toBe(`/${org.properties.A!.code}/billing/${folio.id}`);
  });

  it("searches rooms and rate plans on the server, opening rooms where the user can see them", async () => {
    const rooms = (await search(admin, "10", A)).body.data;
    const roomHits = hitsOf(rooms, "rooms");
    expect(roomHits.map((h) => h.title)).toEqual([
      "Room 101",
      "Room 102",
      "Room 103",
      "Room 104",
      "Room 105",
    ]);
    expect(roomHits[0]!.subtitle).toMatch(/^KNG/);
    expect(roomHits[0]!.roomView).toBe("housekeeping");
    expect(searchResultRoute(roomHits[0]!)).toBe(
      `/${org.properties.A!.code}/housekeeping?room=${roomHits[0]!.id}`,
    );
    const plans = hitsOf((await search(admin, "best available", A)).body.data, "ratePlans");
    expect(plans.map((h) => h.title)).toContain("BAR · Best available rate");

    const frontDeskOnly = await customSession("rooms-fd", [
      { permissions: ["rooms:read", "frontdesk:read"], property: "A" },
    ]);
    const fd = hitsOf((await search(frontDeskOnly, "101", A)).body.data, "rooms");
    expect(fd[0]!.roomView).toBe("front-desk");
    const nowhere = await customSession("rooms-none", [
      { permissions: ["rooms:read"], property: "A" },
    ]);
    expect(typesOf((await search(nowhere, "101", A)).body.data)).toEqual([]);
  });

  it("validates the text like the per-type searches did", async () => {
    expect((await search(admin, "z", A)).status).toBe(400);
    expect((await search(admin, "x".repeat(101), A)).status).toBe(400);
    expect((await search(admin, "   ", A)).status).toBe(400);
  });

  it("does not add Server-Timing unless SERVER_TIMING=1", async () => {
    const r = await search(admin, TERM, A);
    expect(r.response.headers.get("server-timing")).toBeNull();
  });
});

describe("unified global search: permissions and isolation", () => {
  it("omits every type the user may not read at the property", async () => {
    const jar = await customSession("res-only", [
      { permissions: ["reservations:read"], property: "A" },
    ]);
    expect(typesOf((await search(jar, TERM, A)).body.data)).toEqual(["reservations"]);
    // No access to B at all: refused like every property route.
    expect((await search(jar, TERM, B)).status).toBe(403);
  });

  it("split permissions: each property shows only what is granted there", async () => {
    const jar = await customSession("split", [
      { permissions: ["guests:read"], property: "A" },
      { permissions: ["billing:read"], property: "B" },
    ]);
    const atA = (await search(jar, TERM, A)).body.data;
    expect(typesOf(atA)).toEqual(["guests"]);
    expect(hitsOf(atA, "guests").every((h) => h.propertyCode === org.properties.A!.code)).toBe(
      true,
    );
    const atB = (await search(jar, TERM, B)).body.data;
    expect(typesOf(atB)).toEqual(["folios"]);
    // B's folios only: one stay, in AED.
    expect(hitsOf(atB, "folios")).toHaveLength(1);
    expect(hitsOf(atB, "folios")[0]!.meta).toMatch(/^AED /);
    expect(hitsOf(atB, "folios")[0]!.propertyCode).toBe(org.properties.B!.code);
  });

  it("multi-property user: each property's search is scoped to that property", async () => {
    const jar = await customSession("multi", [
      { permissions: ["reservations:read", "billing:read"], property: "A" },
      { permissions: ["reservations:read", "billing:read"], property: "B" },
    ]);
    const atA = hitsOf((await search(jar, TERM, A)).body.data, "reservations");
    const atB = hitsOf((await search(jar, TERM, B)).body.data, "reservations");
    expect(atA.length).toBe(5);
    expect(atB.length).toBe(1);
    const inA = await prisma.reservationRoom.findMany({
      where: { id: { in: atA.map((h) => h.id) } },
      select: { propertyId: true },
    });
    expect(new Set(inA.map((r) => r.propertyId))).toEqual(new Set([A]));
    const inB = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: atB[0]!.id },
      select: { propertyId: true },
    });
    expect(inB.propertyId).toBe(B);
  });

  it("organization search: profiles only, each routed to a property that grants it", async () => {
    const split = await customSession("org-split", [
      { permissions: ["accounts:read"], property: "A" },
      { permissions: ["guests:read"], property: "B" },
    ]);
    const result = (await search(split, TERM)).body.data;
    expect(typesOf(result)).toEqual(["guests", "companies"]);
    expect(hitsOf(result, "guests").every((h) => h.propertyCode === org.properties.B!.code)).toBe(
      true,
    );
    expect(
      hitsOf(result, "companies").every((h) => h.propertyCode === org.properties.A!.code),
    ).toBe(true);

    const companiesOnly = await customSession("org-acc", [
      { permissions: ["accounts:read"], property: "A" },
    ]);
    expect(typesOf((await search(companiesOnly, TERM)).body.data)).toEqual(["companies"]);

    const nothing = await customSession("org-none", [
      { permissions: ["reservations:read"], property: "A" },
    ]);
    const none = await search(nothing, TERM);
    expect(none.status).toBe(200);
    expect(none.body.data.groups).toEqual([]);
  });

  it("never returns another organization's records", async () => {
    const own = (await search(admin, TERM)).body.data;
    const ownGuests = hitsOf(own, "guests").map((h) => h.id);
    const theirs = (await search(outsider, TERM)).body.data;
    for (const hit of theirs.groups.flatMap((g) => g.hits)) {
      expect(ownGuests).not.toContain(hit.id);
      expect(hit.propertyCode).not.toBe(org.properties.A!.code);
    }
    // The outsider's own namesake is found, in their own property.
    expect(hitsOf(theirs, "guests").map((h) => h.title)).toEqual(["Otto Zephyrine"]);
    // Another organization's property is indistinguishable from a missing one.
    expect((await search(outsider, TERM, A)).status).toBe(403);
  });

  it("refuses invalid, revoked and disabled sessions", async () => {
    const anonymous = await call(organizationSearchRoute, { path: `/api/v1/search?q=${TERM}` });
    expect(anonymous.status).toBe(401);
    const forged = await call(propertySearchRoute, {
      path: `${P(A)}/search?q=${TERM}`,
      params: { propertyId: A },
      headers: { cookie: "__Host-sm_at=not-a-token" },
    });
    expect(forged.status).toBe(401);

    const user = await createCustomUser(org, "revoked", [
      { permissions: ["guests:read"], property: "A" },
    ]);
    const revoked = await loginAs(user.email, TEST_PASSWORD);
    expect((await search(revoked, TERM, A)).status).toBe(200);
    const signedOut = new Map([["cookie", revoked.header()]]);
    await call(logoutRoute, { method: "POST", path: "/api/v1/auth/logout", jar: revoked });
    const replay = await call(propertySearchRoute, {
      path: `${P(A)}/search?q=${TERM}`,
      params: { propertyId: A },
      headers: { cookie: signedOut.get("cookie")! },
    });
    expect(replay.status).toBe(401);

    const disabledUser = await createCustomUser(org, "disabled", [
      { permissions: ["guests:read"], property: "A" },
    ]);
    const disabled = await loginAs(disabledUser.email, TEST_PASSWORD);
    expect((await search(disabled, TERM)).status).toBe(200);
    await prisma.user.update({ where: { id: disabledUser.id }, data: { status: "DISABLED" } });
    expect((await search(disabled, TERM)).status).toBe(401);
  });
});
