import { describe, expect, it } from "vitest";
import {
  arrivalState,
  checkoutTiming,
  stayTransitionProblem,
} from "@/modules/front-desk/front-desk.policy";
import {
  checkInSchema,
  checkOutSchema,
  roomMoveSchema,
  walkInSchema,
} from "@/modules/front-desk/front-desk.schema";
import { transitionProblem } from "@/modules/reservations/reservations.policy";
import {
  isOverridableReadiness,
  roomBoardStatus,
  roomReadiness,
} from "@/modules/rooms/rooms.policy";

const ID = "01900000-0000-7000-8000-000000000001";
const D = "2026-10-10";

describe("room readiness", () => {
  const room = (overrides: Partial<Parameters<typeof roomReadiness>[0]> = {}) => ({
    housekeepingStatus: "CLEAN" as const,
    frontOfficeStatus: "VACANT" as const,
    outOfOrder: false,
    outOfService: false,
    ...overrides,
  });

  it("puts out of order and occupied before cleanliness", () => {
    expect(roomReadiness(room({ outOfOrder: true, frontOfficeStatus: "OCCUPIED" }), false)).toBe(
      "OUT_OF_ORDER",
    );
    expect(roomReadiness(room({ frontOfficeStatus: "OCCUPIED" }), false)).toBe("OCCUPIED");
  });

  it("requires clean, or inspected when the property demands it", () => {
    expect(roomReadiness(room(), false)).toBe("READY");
    expect(roomReadiness(room(), true)).toBe("NOT_INSPECTED");
    expect(roomReadiness(room({ housekeepingStatus: "INSPECTED" }), true)).toBe("READY");
    expect(roomReadiness(room({ housekeepingStatus: "DIRTY" }), false)).toBe("DIRTY");
    expect(roomReadiness(room({ housekeepingStatus: "PICKUP" }), false)).toBe("DIRTY");
  });

  it("allows an override only for cleanliness problems", () => {
    expect(isOverridableReadiness("DIRTY")).toBe(true);
    expect(isOverridableReadiness("NOT_INSPECTED")).toBe(true);
    expect(isOverridableReadiness("OCCUPIED")).toBe(false);
    expect(isOverridableReadiness("OUT_OF_ORDER")).toBe(false);
  });

  it("classifies the room board", () => {
    expect(roomBoardStatus(room(), false)).toBe("VACANT_READY");
    expect(roomBoardStatus(room({ housekeepingStatus: "DIRTY" }), false)).toBe("VACANT_NOT_READY");
    expect(roomBoardStatus(room({ frontOfficeStatus: "OCCUPIED" }), false)).toBe("OCCUPIED");
    expect(roomBoardStatus(room({ outOfOrder: true }), false)).toBe("OUT_OF_ORDER");
  });
});

describe("reservation state machine: front desk transitions", () => {
  const res = (status: "RESERVED" | "IN_HOUSE" | "CANCELLED" | "WAITLISTED", extra = {}) => ({
    status,
    deductsInventory: true,
    arrival: D,
    departure: "2026-10-12",
    ...extra,
  });

  it("checks in a confirmed arrival on the business date only", () => {
    expect(transitionProblem("check_in", res("RESERVED"), D)).toBeNull();
    expect(transitionProblem("check_in", res("RESERVED", { deductsInventory: false }), D)).toMatch(
      /Confirm the reservation/,
    );
    expect(transitionProblem("check_in", res("RESERVED", { arrival: "2026-10-11" }), D)).toMatch(
      /check-in opens on the arrival date/,
    );
    expect(transitionProblem("check_in", res("RESERVED", { arrival: "2026-10-09" }), D)).toMatch(
      /has passed/,
    );
    expect(transitionProblem("check_in", res("IN_HOUSE"), D)).not.toBeNull();
    expect(transitionProblem("check_in", res("CANCELLED"), D)).not.toBeNull();
    expect(transitionProblem("check_in", res("WAITLISTED"), D)).not.toBeNull();
  });

  it("checks out and moves only in-house guests", () => {
    expect(transitionProblem("check_out", res("IN_HOUSE"), D)).toBeNull();
    expect(transitionProblem("check_out", res("RESERVED"), D)).not.toBeNull();
    expect(transitionProblem("room_move", res("IN_HOUSE"), D)).toBeNull();
    expect(transitionProblem("room_move", res("RESERVED"), D)).toMatch(/use room assignment/);
  });

  it("keeps in-house reservations away from pre-arrival commands", () => {
    expect(transitionProblem("modify", res("IN_HOUSE"), D)).not.toBeNull();
    expect(transitionProblem("cancel", res("IN_HOUSE"), D)).not.toBeNull();
    expect(transitionProblem("assign_room", res("IN_HOUSE"), D)).not.toBeNull();
    expect(transitionProblem("no_show", res("IN_HOUSE"), D)).not.toBeNull();
  });
});

describe("stay lifecycle", () => {
  it("classifies check-out timing against the business date", () => {
    expect(checkoutTiming({ arrival: "2026-10-08", departure: D }, D)).toBe("ON_TIME");
    expect(checkoutTiming({ arrival: "2026-10-05", departure: "2026-10-09" }, D)).toBe("OVERSTAY");
    expect(checkoutTiming({ arrival: "2026-10-09", departure: "2026-10-12" }, D)).toBe("EARLY");
    expect(checkoutTiming({ arrival: D, departure: "2026-10-12" }, D)).toBe("SAME_DAY");
  });

  it("allows stay commands only while in house", () => {
    expect(stayTransitionProblem("check_out", "IN_HOUSE")).toBeNull();
    expect(stayTransitionProblem("check_out", "CHECKED_OUT")).toMatch(/already checked out/);
    expect(stayTransitionProblem("room_move", "CHECKED_OUT")).not.toBeNull();
  });

  it("derives the arrival row state", () => {
    const base = { status: "RESERVED", deductsInventory: true, hasRoom: true };
    expect(arrivalState({ ...base, readiness: "READY" })).toBe("READY");
    expect(arrivalState({ ...base, readiness: "DIRTY" })).toBe("ROOM_NOT_READY");
    expect(arrivalState({ ...base, hasRoom: false, readiness: null })).toBe("UNASSIGNED");
    expect(arrivalState({ ...base, deductsInventory: false, readiness: "READY" })).toBe(
      "NEEDS_CONFIRMATION",
    );
    expect(arrivalState({ ...base, status: "IN_HOUSE", readiness: null })).toBe("CHECKED_IN");
  });
});

describe("front desk contracts", () => {
  it("requires a reason to accept a room that is not ready", () => {
    expect(checkInSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(checkInSchema.safeParse({ version: 1, acceptNotReady: true }).success).toBe(false);
    expect(
      checkInSchema.safeParse({ version: 1, acceptNotReady: true, reason: "Guest waiting" })
        .success,
    ).toBe(true);
    expect(checkInSchema.safeParse({ version: 1, status: "IN_HOUSE" }).success).toBe(false);
  });

  it("requires a reason code for moves and early departures", () => {
    expect(roomMoveSchema.safeParse({ version: 1, roomId: ID }).success).toBe(false);
    expect(roomMoveSchema.safeParse({ version: 1, roomId: ID, reasonCodeId: ID }).success).toBe(
      true,
    );
    expect(checkOutSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(checkOutSchema.safeParse({ version: 1, earlyDeparture: true }).success).toBe(false);
    expect(
      checkOutSchema.safeParse({ version: 1, earlyDeparture: true, reasonCodeId: ID }).success,
    ).toBe(true);
  });

  it("restricts walk-ins to one specific room", () => {
    const walkIn = {
      arrival: D,
      departure: "2026-10-11",
      adults: 1,
      roomTypeId: ID,
      ratePlanId: ID,
      reservationTypeId: ID,
      guestId: ID,
    };
    expect(walkInSchema.safeParse({ ...walkIn, roomId: ID }).success).toBe(true);
    expect(walkInSchema.safeParse(walkIn).success).toBe(false);
    expect(walkInSchema.safeParse({ ...walkIn, roomId: ID, waitlist: true }).success).toBe(false);
  });
});
