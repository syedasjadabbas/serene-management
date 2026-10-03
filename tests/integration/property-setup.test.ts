import { beforeAll, describe, expect, it } from "vitest";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as createFloorRoute } from "@/app/api/v1/properties/[propertyId]/setup/floors/route";
import { PATCH as updateRoomTypeRoute } from "@/app/api/v1/properties/[propertyId]/setup/room-types/[roomTypeId]/route";
import { POST as createRoomTypeRoute } from "@/app/api/v1/properties/[propertyId]/setup/room-types/route";
import { PATCH as updateRoomRoute } from "@/app/api/v1/properties/[propertyId]/setup/rooms/[roomId]/route";
import { POST as createRoomsRoute } from "@/app/api/v1/properties/[propertyId]/setup/rooms/route";
import { GET as setupRoute } from "@/app/api/v1/properties/[propertyId]/setup/route";
import { PATCH as updateTaxRoute } from "@/app/api/v1/properties/[propertyId]/setup/taxes/[taxRuleId]/route";
import { POST as createTaxRoute } from "@/app/api/v1/properties/[propertyId]/setup/taxes/route";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import type { PropertySetupView } from "@/modules/setup/setup.types";
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
 * Property setup (modules/setup): room types, floors, rooms and taxes created
 * through the product instead of the developer seed, with inventory recounted
 * and occupied rooms protected.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;
let org: FixtureOrg;
let A: string;
let inv: Inventory;
let D: string;
let admin: CookieJar;
let agent: CookieJar;
let guestId: string;
const reason = "Property setup test";
const base = () => `/api/v1/properties/${A}/setup`;

async function setup(): Promise<PropertySetupView> {
  const r = await call(setupRoute, { path: base(), params: { propertyId: A }, jar: admin });
  expect(r.status).toBe(200);
  return r.body.data as PropertySetupView;
}
const post = (route: typeof createFloorRoute, path: string, body: unknown, jar = admin) =>
  call(route, { method: "POST", path: `${base()}/${path}`, params: { propertyId: A }, body, jar });
const patch = (
  route: typeof updateRoomRoute,
  path: string,
  params: Record<string, string>,
  body: unknown,
) =>
  call(route, {
    method: "PATCH",
    path: `${base()}/${path}`,
    params: { propertyId: A, ...params },
    body,
    jar: admin,
  });

async function physical(roomTypeId: string, date: string) {
  const row = await prisma.roomTypeInventory.findFirst({
    where: { roomTypeId, stayDate: fromDateOnly(date) },
    select: { physicalRooms: true },
  });
  return row?.physicalRooms ?? null;
}

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 2 }]);
  D = inv.businessDate;
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
  const desk = await createUser(org, "desk", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
  agent = await loginAs(desk.email, TEST_PASSWORD);
  guestId = (await createGuestRow(org, "Setup", "Guest")).id;
});

describe("reading the setup", () => {
  it("lists room types, rooms and the go-live checklist", async () => {
    const view = await setup();
    const kng = view.roomTypes.find((t) => t.code === "KNG")!;
    expect(kng.activeRooms).toBe(2);
    expect(view.readiness.live).toBe(true);
    expect(view.readiness.rooms).toBe(2);
    expect(view.revenueCodes.map((c) => c.code)).toContain("1000");
    expect(view.revenueCodes.some((c) => c.code.startsWith("9"))).toBe(false); // no payment codes
  });

  it("is refused without settings permissions", async () => {
    const r = await call(setupRoute, { path: base(), params: { propertyId: A }, jar: agent });
    expect(r.status).toBe(403);
    const w = await post(
      createFloorRoute,
      "floors",
      { code: "X", name: "X", level: 9, reason },
      agent,
    );
    expect(w.status).toBe(403);
  });
});

describe("room types, floors and rooms", () => {
  let dlx: string;
  let floor: string;

  it("creates a room type and refuses duplicates and impossible occupancy", async () => {
    const body = {
      code: "dlx",
      name: "Deluxe",
      maxOccupancy: 3,
      maxAdults: 2,
      maxChildren: 1,
      defaultOccupancy: 2,
      reason,
    };
    expect((await post(createRoomTypeRoute, "room-types", body)).status).toBe(201);
    dlx = (await setup()).roomTypes.find((t) => t.code === "DLX")!.id;
    expect((await post(createRoomTypeRoute, "room-types", body)).status).toBe(400);
    const bad = await post(createRoomTypeRoute, "room-types", {
      ...body,
      code: "BIG",
      maxAdults: 4,
    });
    expect(bad.status).toBe(400);
  });

  it("creates a floor and a numbered range of rooms; refuses existing numbers", async () => {
    expect(
      (await post(createFloorRoute, "floors", { code: "F5", name: "Floor 5", level: 5, reason }))
        .status,
    ).toBe(201);
    floor = (await setup()).floors.find((f) => f.code === "F5")!.id;
    const r = await post(createRoomsRoute, "rooms", {
      numbers: ["501", "502", "503"],
      roomTypeId: dlx,
      floorId: floor,
      housekeepingStatus: "INSPECTED",
      reason,
    });
    expect(r.status).toBe(201);
    const view = r.body.data as PropertySetupView;
    expect(view.roomTypes.find((t) => t.id === dlx)!.activeRooms).toBe(3);
    expect(view.rooms.filter((x) => x.roomTypeId === dlx).map((x) => x.housekeepingStatus)).toEqual(
      ["INSPECTED", "INSPECTED", "INSPECTED"],
    );
    const again = await post(createRoomsRoute, "rooms", {
      numbers: ["503", "504"],
      roomTypeId: dlx,
      floorId: floor,
      reason,
    });
    expect(again.status).toBe(400);
    expect(await prisma.room.count({ where: { propertyId: A, number: "504" } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({
      where: { propertyId: A, action: "setup.rooms_create" },
    });
    expect(audit?.risk).toBe("HIGH");
  });

  it("refuses to retire a room type that still has active rooms", async () => {
    const view = await setup();
    const type = view.roomTypes.find((t) => t.id === dlx)!;
    const r = await patch(
      updateRoomTypeRoute,
      `room-types/${dlx}`,
      { roomTypeId: dlx },
      {
        name: type.name,
        maxOccupancy: 3,
        maxAdults: 2,
        maxChildren: 1,
        defaultOccupancy: 2,
        status: "INACTIVE",
        reason,
      },
    );
    expect(r.status).toBe(422);
    expect((r.body.error as { details: { reason: string } }).details.reason).toBe(
      "ROOM_TYPE_HAS_ROOMS",
    );
  });
});

describe("inventory and occupied rooms", () => {
  it("recounts sold nights when rooms are added or retired, and protects an occupied room", async () => {
    const kng = inv.roomTypes.KNG!;
    // A booking creates the counters of its nights.
    const booked = await call(createReservationRoute, {
      method: "POST",
      path: `/api/v1/properties/${A}/reservations`,
      params: { propertyId: A },
      body: {
        arrival: D,
        departure: addDays(D, 2),
        adults: 2,
        children: 0,
        rooms: 1,
        roomTypeId: kng.id,
        ratePlanId: inv.ratePlans.BAR!,
        reservationTypeId: inv.reservationTypes.GTD!,
        guestId,
      },
      jar: admin,
    });
    expect(booked.status).toBe(201);
    expect(await physical(kng.id, D)).toBe(2);

    // A new KNG room raises the physical count of every future night.
    const added = await post(createRoomsRoute, "rooms", {
      numbers: ["K99"],
      roomTypeId: kng.id,
      floorId: null,
      housekeepingStatus: "INSPECTED",
      reason,
    });
    expect(added.status).toBe(201);
    expect(await physical(kng.id, D)).toBe(3);
    expect(await physical(kng.id, addDays(D, 1))).toBe(3);

    const k99 = (added.body.data as PropertySetupView).rooms.find((r) => r.number === "K99")!;
    // Check the guest into K99: it is now occupied.
    const rr = booked.body.data.rooms[0] as { id: string; version: number };
    const checkedIn = await call(checkInRoute, {
      method: "POST",
      path: `/api/v1/properties/${A}/reservation-rooms/${rr.id}/check-in`,
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: rr.version, roomId: k99.id },
      jar: admin,
    });
    expect(checkedIn.status).toBe(201);
    // Check-in changed the room (occupied): edits must send its current version.
    const occupied = (await setup()).rooms.find((r) => r.id === k99.id)!;
    expect(occupied.frontOfficeStatus).toBe("OCCUPIED");

    const retire = await patch(
      updateRoomRoute,
      `rooms/${k99.id}`,
      { roomId: k99.id },
      {
        number: "K99",
        roomTypeId: kng.id,
        floorId: null,
        isSmoking: false,
        isAccessible: false,
        status: "INACTIVE",
        version: occupied.version,
        reason,
      },
    );
    expect(retire.status).toBe(422);
    expect((retire.body.error as { details: { reason: string } }).details.reason).toBe(
      "ROOM_OCCUPIED",
    );

    // An unoccupied room can be retired: the count goes back down.
    const view = await setup();
    const spare = view.rooms.find((r) => r.roomTypeId === kng.id && r.number !== "K99")!;
    const ok = await patch(
      updateRoomRoute,
      `rooms/${spare.id}`,
      { roomId: spare.id },
      {
        number: spare.number,
        roomTypeId: kng.id,
        floorId: spare.floorId,
        isSmoking: false,
        isAccessible: false,
        status: "INACTIVE",
        version: spare.version,
        reason,
      },
    );
    expect(ok.status).toBe(200);
    expect(await physical(kng.id, D)).toBe(2);

    // A stale version is refused.
    const stale = await patch(
      updateRoomRoute,
      `rooms/${spare.id}`,
      { roomId: spare.id },
      {
        number: spare.number,
        roomTypeId: kng.id,
        floorId: spare.floorId,
        isSmoking: false,
        isAccessible: false,
        status: "ACTIVE",
        version: spare.version,
        reason,
      },
    );
    expect(stale.status).toBe(409);
  });
});

describe("taxes", () => {
  it("creates a tax with its own posting code on chosen revenue codes, and edits it", async () => {
    const view = await setup();
    const room = view.revenueCodes.find((c) => c.code === "1000")!;
    const restaurant = view.revenueCodes.find((c) => c.code === "2000")!;
    const r = await post(createTaxRoute, "taxes", {
      code: "GST",
      name: "Sales tax",
      calculation: "PERCENT",
      rate: "16",
      effectiveFrom: D,
      appliesTo: [room.id],
      reason,
    });
    expect(r.status).toBe(201);
    const tax = (r.body.data as PropertySetupView).taxes.find((t) => t.code === "GST")!;
    expect(tax.rate).toBe("16.0000");
    expect(tax.appliesTo.map((c) => c.code)).toEqual(["1000"]);
    const rule = await prisma.taxRule.findUniqueOrThrow({
      where: { id: tax.id },
      select: {
        transactionCode: { select: { code: true, bucket: true, isManualPostAllowed: true } },
      },
    });
    expect(rule.transactionCode.bucket).toBe("TAX");
    expect(rule.transactionCode.isManualPostAllowed).toBe(false);
    expect(rule.transactionCode.code).toMatch(/^8\d{3}$/);

    const over = await post(createTaxRoute, "taxes", {
      code: "BAD",
      name: "Bad",
      calculation: "PERCENT",
      rate: "120",
      effectiveFrom: D,
      reason,
    });
    expect(over.status).toBe(400);

    const edited = await patch(
      updateTaxRoute,
      `taxes/${tax.id}`,
      { taxRuleId: tax.id },
      {
        name: "Sales tax",
        calculation: "PERCENT",
        basis: "NET",
        rate: "17",
        effectiveFrom: D,
        effectiveTo: null,
        appliesTo: [room.id, restaurant.id],
        status: "ACTIVE",
        reason,
      },
    );
    expect(edited.status).toBe(200);
    const after = (edited.body.data as PropertySetupView).taxes.find((t) => t.id === tax.id)!;
    expect(after.rate).toBe("17.0000");
    expect(after.appliesTo.map((c) => c.code).sort()).toEqual(["1000", "2000"]);
  });
});
