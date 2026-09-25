import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { prisma } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { ALL_PERMISSIONS } from "@/lib/permissions/catalog";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import { startNightAudit } from "@/modules/night-audit/night-audit.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { call, loginAs } from "./support/http";

/**
 * Night audit at hotel scale (Phase 8 completion criterion): 1 000 rooms in
 * house. One stay is created through the real booking and check-in
 * commands; the other 999 are cloned from it in SQL (same shape as the
 * services write: reservation room IN_HOUSE with its room, the nights, the
 * stay, the room occupied). The audit must post every room, reconcile and
 * close inside its commit timeout.
 */

const ROOMS = 1000;
let org: FixtureOrg;
let A: string;
let D: string;

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  const inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: ROOMS }], {
    taxes: [
      {
        code: "GST",
        name: "Sales tax 16%",
        calculation: "PERCENT",
        basis: "NET",
        rate: "16",
        sequence: 1,
        appliesTo: ["1000"],
      },
    ],
  });
  D = inv.businessDate;
  await prisma.room.updateMany({
    where: { propertyId: A },
    data: { housekeepingStatus: "INSPECTED", frontOfficeStatus: "VACANT" },
  });
  const guestId = (await createGuestRow(org, "Scale", "Test")).id;
  const fom = await loginAs(
    (await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }])).email,
    TEST_PASSWORD,
  );
  const roomIds = inv.roomTypes.KNG!.roomIds;
  const booked = await call(createReservationRoute, {
    method: "POST",
    path: `/api/v1/properties/${A}/reservations`,
    params: { propertyId: A },
    body: {
      arrival: D,
      departure: addDays(D, 2),
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
      roomId: roomIds[0],
    },
    jar: fom,
  });
  expect(booked.status).toBe(201);
  const template = booked.body.data.rooms[0] as { id: string; version: number };
  const checkedIn = await call(checkInRoute, {
    method: "POST",
    path: `/api/v1/properties/${A}/reservation-rooms/${template.id}/check-in`,
    params: { propertyId: A, reservationRoomId: template.id },
    body: { version: template.version },
    jar: fom,
  });
  expect(checkedIn.status).toBe(201);

  // Clone 999 more in-house stays, one per remaining room.
  const others = roomIds.slice(1);
  await prisma.$executeRaw`
    WITH t AS (SELECT * FROM "reservation_rooms" WHERE "id" = ${template.id}::uuid),
    rooms AS (
      SELECT r."id" AS "room_id", row_number() OVER (ORDER BY r."number") AS "n"
      FROM "rooms" r WHERE r."id" = ANY(${others}::uuid[])
    )
    INSERT INTO "reservation_rooms" ("id", "property_id", "reservation_id", "line_number", "status",
      "primary_guest_id", "arrival_date", "departure_date", "adults", "children", "room_type_id",
      "rate_room_type_id", "room_id", "rate_plan_id", "currency_code", "reservation_type_id",
      "market_code_id", "source_code_id", "updated_at")
    SELECT gen_random_uuid(), t."property_id", t."reservation_id", t."line_number" + rooms."n",
      'IN_HOUSE', t."primary_guest_id", t."arrival_date", t."departure_date", t."adults", t."children",
      t."room_type_id", t."rate_room_type_id", rooms."room_id", t."rate_plan_id", t."currency_code",
      t."reservation_type_id", t."market_code_id", t."source_code_id", now()
    FROM t CROSS JOIN rooms`;
  await prisma.$executeRaw`
    INSERT INTO "reservation_room_nights" ("property_id", "reservation_room_id", "stay_date",
      "room_type_id", "rate_plan_id", "rate_amount", "currency_code", "adults", "children")
    SELECT n."property_id", rr."id", n."stay_date", n."room_type_id", n."rate_plan_id", n."rate_amount",
      n."currency_code", n."adults", n."children"
    FROM "reservation_rooms" rr
    JOIN "reservation_room_nights" n ON n."reservation_room_id" = ${template.id}::uuid
    WHERE rr."reservation_id" = (SELECT "reservation_id" FROM "reservation_rooms" WHERE "id" = ${template.id}::uuid)
      AND rr."id" <> ${template.id}::uuid`;
  await prisma.$executeRaw`
    INSERT INTO "stays" ("id", "property_id", "reservation_room_id", "primary_guest_id", "room_id",
      "checked_in_at", "checked_in_by_id", "arrival_business_date", "updated_at")
    SELECT gen_random_uuid(), rr."property_id", rr."id", rr."primary_guest_id", rr."room_id", now(),
      ${org.adminId}::uuid, ${D}::date, now()
    FROM "reservation_rooms" rr
    WHERE rr."reservation_id" = (SELECT "reservation_id" FROM "reservation_rooms" WHERE "id" = ${template.id}::uuid)
      AND rr."id" <> ${template.id}::uuid`;
  await prisma.room.updateMany({
    where: { id: { in: others } },
    data: { frontOfficeStatus: "OCCUPIED" },
  });
}, 600_000);

describe("night audit with 1 000 rooms in house", () => {
  it("posts every room and closes the date inside the commit timeout", async () => {
    const ctx: PropertyContext = {
      ...org.adminCtx,
      access: { ...org.adminCtx.access, byProperty: { [A]: ALL_PERMISSIONS } },
      propertyId: A,
      propertyCode: "PERF",
      timezone: "Asia/Karachi",
      currencyCode: "PKR",
      businessDate: D,
    };
    const started = performance.now();
    const run = await startNightAudit(
      ctx,
      { reason: "Scale test" },
      { key: `perf-${randomUUID()}`, route: "POST /perf", requestHash: "e".repeat(64) },
    );
    const seconds = (performance.now() - started) / 1000;
    console.warn(`Night audit, ${ROOMS} rooms in house: ${seconds.toFixed(1)} s`);
    expect(run.status).toBe("COMPLETED");
    expect(run.summary!.roomsPosted).toBe(ROOMS);
    expect(run.summary!.nightsPosted).toBe(ROOMS);
    // Room line + tax line per room.
    expect(run.summary!.linesPosted).toBe(ROOMS * 2);
    const stats = await prisma.dailyStatistic.findUniqueOrThrow({
      where: { propertyId_businessDate: { propertyId: A, businessDate: fromDateOnly(D) } },
    });
    expect(stats.roomsSold).toBe(ROOMS);
    expect(stats.physicalRooms).toBe(ROOMS);
    // Well inside the 300 s commit timeout.
    expect(seconds).toBeLessThan(180);
  }, 600_000);
});
