import { describe, expect, it } from "vitest";
import { availabilityQuerySchema } from "@/modules/availability/availability.schema";
import {
  localMidnightUtc,
  timeZoneOffsetMinutes,
} from "@/modules/business-date/business-date.policy";
import { createGuestSchema } from "@/modules/guests/guests.schema";
import { guestSearchName, normalizeName } from "@/modules/guests/guests.policy";
import {
  createReservationSchema,
  listReservationsQuerySchema,
  updateReservationRoomSchema,
} from "@/modules/reservations/reservations.schema";

const ID = "01900000-0000-7000-8000-000000000001";
const valid = {
  arrival: "2026-10-10",
  departure: "2026-10-12",
  adults: 2,
  roomTypeId: ID,
  ratePlanId: ID,
  reservationTypeId: ID,
  guestId: ID,
};

describe("availability query validation", () => {
  it("coerces query strings and rejects invalid ranges", () => {
    expect(
      availabilityQuerySchema.parse({
        arrival: "2026-10-10",
        departure: "2026-10-11",
        adults: "2",
      }),
    ).toMatchObject({
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(
      availabilityQuerySchema.safeParse({
        arrival: "2026-10-10",
        departure: "2026-10-10",
        adults: "1",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        arrival: "2026-10-10",
        departure: "2026-10-09",
        adults: "1",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        arrival: "2026-10-10",
        departure: "2027-03-10",
        adults: "1",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        arrival: "2026-10-10",
        departure: "2026-10-11",
        adults: "0",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        arrival: "2026-10-10",
        departure: "2026-10-11",
        adults: "1",
        rooms: "21",
      }).success,
    ).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        arrival: "2026-10-10",
        departure: "2026-10-11",
        adults: "1",
        extra: "x",
      }).success,
    ).toBe(false);
  });
});

describe("reservation contract validation", () => {
  it("accepts a valid booking and applies defaults", () => {
    expect(createReservationSchema.parse(valid)).toMatchObject({
      rooms: 1,
      children: 0,
      waitlist: false,
      override: false,
    });
  });

  it("rejects bad dates, guest counts and inconsistent options", () => {
    const bad = (patch: Record<string, unknown>) =>
      createReservationSchema.safeParse({ ...valid, ...patch }).success;
    expect(bad({ departure: "2026-10-10" })).toBe(false);
    expect(bad({ adults: 0 })).toBe(false);
    expect(bad({ children: -1 })).toBe(false);
    expect(bad({ rooms: 2, roomId: ID })).toBe(false);
    expect(bad({ waitlist: true, roomId: ID })).toBe(false);
    expect(bad({ override: true })).toBe(false); // override needs a reason
    expect(bad({ override: true, reason: "VIP guest, GM approved" })).toBe(true);
    expect(bad({ confirmationNumber: "123" })).toBe(false); // never accepted from the client
    expect(bad({ status: "CANCELLED" })).toBe(false);
  });

  it("requires at least one change on update", () => {
    expect(updateReservationRoomSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateReservationRoomSchema.safeParse({ version: 1, adults: 1 }).success).toBe(true);
    expect(
      updateReservationRoomSchema.safeParse({
        version: 1,
        arrival: "2026-10-12",
        departure: "2026-10-12",
      }).success,
    ).toBe(false);
  });

  it("parses list filters", () => {
    expect(
      listReservationsQuerySchema.parse({ state: "CONFIRMED,TENTATIVE", limit: "25" }),
    ).toMatchObject({
      state: ["CONFIRMED", "TENTATIVE"],
      limit: 25,
      sort: "arrival",
    });
    expect(listReservationsQuerySchema.safeParse({ state: "BOGUS" }).success).toBe(false);
    expect(listReservationsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("guest input", () => {
  it("normalizes names for search", () => {
    expect(normalizeName("  Zoë   Ölçer ")).toBe("zoe olcer");
    expect(guestSearchName("Hamza", "Qureshi")).toBe("qureshi hamza");
  });

  it("validates guest profiles", () => {
    expect(createGuestSchema.safeParse({ firstName: "A", lastName: "B", email: "" }).success).toBe(
      true,
    );
    expect(
      createGuestSchema.safeParse({ firstName: "A", lastName: "B", email: "nope" }).success,
    ).toBe(false);
    expect(createGuestSchema.safeParse({ firstName: "", lastName: "B" }).success).toBe(false);
    expect(
      createGuestSchema.safeParse({ firstName: "A", lastName: "B", nationalityCode: "pak" })
        .success,
    ).toBe(false);
  });
});

describe("property-local calendar days", () => {
  it("converts a local midnight to UTC in the property time zone", () => {
    expect(localMidnightUtc("2026-10-10", "Asia/Karachi").toISOString()).toBe(
      "2026-10-09T19:00:00.000Z",
    );
    expect(localMidnightUtc("2026-10-10", "Asia/Dubai").toISOString()).toBe(
      "2026-10-09T20:00:00.000Z",
    );
    expect(localMidnightUtc("2026-10-10", "America/Los_Angeles").toISOString()).toBe(
      "2026-10-10T07:00:00.000Z",
    );
    // After US DST ends (Nov 1), Los Angeles is UTC-8.
    expect(localMidnightUtc("2026-11-02", "America/Los_Angeles").toISOString()).toBe(
      "2026-11-02T08:00:00.000Z",
    );
    expect(timeZoneOffsetMinutes(new Date("2026-10-10T00:00:00Z"), "Asia/Karachi")).toBe(300);
  });
});
