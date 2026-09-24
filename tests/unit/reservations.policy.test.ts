import { describe, expect, it } from "vitest";
import {
  bookingState,
  consumesInventory,
  displayConfirmation,
  formatConfirmationNumber,
  nightCount,
  occupancyProblems,
  stayNights,
  staysOverlap,
  transitionProblem,
} from "@/modules/reservations/reservations.policy";

describe("hotel-night semantics", () => {
  it("occupies arrival inclusive, departure exclusive", () => {
    expect(stayNights("2026-10-10", "2026-10-13")).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]);
    expect(nightCount("2026-10-10", "2026-10-13")).toBe(3);
    expect(stayNights("2026-10-10", "2026-10-10")).toEqual([]);
    expect(stayNights("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("treats a checkout and a same-day check-in as not overlapping", () => {
    const a = { arrival: "2026-10-10", departure: "2026-10-13" };
    expect(staysOverlap(a, { arrival: "2026-10-13", departure: "2026-10-15" })).toBe(false);
    expect(staysOverlap(a, { arrival: "2026-10-08", departure: "2026-10-10" })).toBe(false);
    expect(staysOverlap(a, { arrival: "2026-10-12", departure: "2026-10-14" })).toBe(true);
    expect(staysOverlap(a, { arrival: "2026-10-09", departure: "2026-10-11" })).toBe(true);
    expect(staysOverlap(a, { arrival: "2026-10-11", departure: "2026-10-12" })).toBe(true);
  });
});

describe("occupancy", () => {
  const room = { maxOccupancy: 3, maxAdults: 2, maxChildren: 1 };
  it("reports every violated limit", () => {
    expect(occupancyProblems(room, 2, 1)).toEqual([]);
    expect(occupancyProblems(room, 3, 0)).toEqual(["TOO_MANY_ADULTS"]);
    expect(occupancyProblems(room, 2, 2)).toEqual(["TOO_MANY_CHILDREN", "TOO_MANY_GUESTS"]);
    expect(occupancyProblems(room, 0, 1)).toEqual(["NO_ADULT"]);
  });
});

describe("booking state", () => {
  it("derives tentative vs confirmed from the reservation type", () => {
    expect(bookingState("RESERVED", false)).toBe("TENTATIVE");
    expect(bookingState("RESERVED", true)).toBe("CONFIRMED");
    expect(bookingState("WAITLISTED", true)).toBe("WAITLISTED");
    expect(bookingState("CANCELLED", true)).toBe("CANCELLED");
  });

  it("only reserved/in-house deducting reservations consume inventory", () => {
    expect(consumesInventory("RESERVED", true)).toBe(true);
    expect(consumesInventory("IN_HOUSE", true)).toBe(true);
    expect(consumesInventory("RESERVED", false)).toBe(false);
    expect(consumesInventory("WAITLISTED", true)).toBe(false);
    expect(consumesInventory("CANCELLED", true)).toBe(false);
    expect(consumesInventory("NO_SHOW", true)).toBe(false);
  });
});

describe("reservation state machine", () => {
  const today = "2026-10-10";
  const res = (
    status: Parameters<typeof bookingState>[0],
    deducts = true,
    arrival = "2026-10-12",
  ) => ({
    status,
    deductsInventory: deducts,
    arrival,
    departure: "2026-10-15",
  });

  it("allows the documented transitions", () => {
    expect(transitionProblem("confirm", res("RESERVED", false), today)).toBeNull();
    expect(transitionProblem("confirm", res("WAITLISTED"), today)).toBeNull();
    expect(transitionProblem("cancel", res("RESERVED"), today)).toBeNull();
    expect(transitionProblem("cancel", res("WAITLISTED"), today)).toBeNull();
    expect(transitionProblem("no_show", res("RESERVED", true, today), today)).toBeNull();
    expect(transitionProblem("reinstate", res("CANCELLED"), today)).toBeNull();
    expect(transitionProblem("modify", res("RESERVED"), today)).toBeNull();
  });

  it("rejects prohibited transitions", () => {
    expect(transitionProblem("confirm", res("RESERVED", true), today)).toMatch(/already confirmed/);
    expect(transitionProblem("cancel", res("CANCELLED"), today)).not.toBeNull();
    expect(transitionProblem("cancel", res("IN_HOUSE"), today)).not.toBeNull();
    expect(transitionProblem("cancel", res("CHECKED_OUT"), today)).not.toBeNull();
    expect(transitionProblem("no_show", res("WAITLISTED", true, today), today)).not.toBeNull();
    expect(transitionProblem("reinstate", res("NO_SHOW"), today)).not.toBeNull();
    expect(transitionProblem("modify", res("CANCELLED"), today)).not.toBeNull();
  });

  it("uses the business date for date guards", () => {
    expect(transitionProblem("no_show", res("RESERVED", true, "2026-10-11"), today)).toMatch(
      /on or after its arrival/,
    );
    expect(transitionProblem("reinstate", res("CANCELLED", true, "2026-10-09"), today)).toMatch(
      /on or after the business date/,
    );
  });
});

describe("confirmation numbers", () => {
  it("formats sequence values and multi-room lines", () => {
    expect(formatConfirmationNumber("", 100245n)).toBe("100245");
    expect(formatConfirmationNumber("X", 1001)).toBe("X1001");
    expect(displayConfirmation("100245", 2, 3)).toBe("100245-2");
    expect(displayConfirmation("100245", 1, 1)).toBe("100245");
  });
});
