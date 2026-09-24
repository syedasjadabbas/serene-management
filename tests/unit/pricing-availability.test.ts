import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/utils/money";
import {
  availableForNight,
  restrictionViolations,
  roomTypeStatus,
  stayAvailability,
  type NightInventory,
} from "@/modules/availability/availability.policy";
import {
  occupancyAmount,
  priceNights,
  selectSeason,
  weekdayBit,
  type RatePlanPricing,
} from "@/modules/rates/rates.policy";

const RT = "rt-1";
const amounts = {
  oneAdult: "100.0000",
  twoAdults: "120.0000",
  threeAdults: null,
  fourAdults: null,
  extraAdult: "30.0000",
  extraChild: "10.0000",
};

const bar: RatePlanPricing = {
  id: "bar",
  parentRatePlanId: null,
  derivationType: null,
  derivationValue: null,
  roundingIncrement: null,
  seasons: [
    {
      id: "base",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      daysOfWeek: 127,
      priority: 0,
      amounts: { [RT]: amounts },
    },
    {
      id: "weekend",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      daysOfWeek: 16 + 32,
      priority: 10,
      amounts: { [RT]: { ...amounts, oneAdult: "150.0000", twoAdults: "170.0000" } },
    },
  ],
};

describe("rate seasons", () => {
  it("maps weekdays to bits", () => {
    expect(weekdayBit("2026-10-12")).toBe(1); // Monday
    expect(weekdayBit("2026-10-16")).toBe(16); // Friday
    expect(weekdayBit("2026-10-18")).toBe(64); // Sunday
  });

  it("picks the highest-priority season covering the date and weekday", () => {
    expect(selectSeason(bar.seasons, "2026-10-12")?.id).toBe("base");
    expect(selectSeason(bar.seasons, "2026-10-16")?.id).toBe("weekend");
    expect(selectSeason(bar.seasons, "2027-01-05")).toBeNull();
  });
});

describe("occupancy pricing", () => {
  it("uses the occupancy column, then extra adults and children", () => {
    expect(formatMoney(occupancyAmount(amounts, 1, 0)!)).toBe("100.0000");
    expect(formatMoney(occupancyAmount(amounts, 2, 0)!)).toBe("120.0000");
    expect(formatMoney(occupancyAmount(amounts, 3, 0)!)).toBe("150.0000");
    expect(formatMoney(occupancyAmount(amounts, 2, 2)!)).toBe("140.0000");
    expect(occupancyAmount({ ...amounts, extraAdult: null }, 3, 0)).toBeNull();
  });
});

describe("stay pricing", () => {
  it("prices each night with weekday/weekend seasons", () => {
    const nights = priceNights(
      bar,
      new Map([["bar", bar]]),
      RT,
      ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"],
      2,
      0,
      2,
    );
    expect(nights.map((n) => (n.amount === null ? null : formatMoney(n.amount, 2)))).toEqual([
      "120.00",
      "170.00",
      "170.00",
      "120.00",
    ]);
  });

  it("derives a plan from its parent with percentage and rounding", () => {
    const adv: RatePlanPricing = {
      id: "adv",
      parentRatePlanId: "bar",
      derivationType: "PERCENT",
      derivationValue: "-10.0000",
      roundingIncrement: "1.0000",
      seasons: [],
    };
    const plans = new Map([
      ["bar", bar],
      ["adv", adv],
    ]);
    const [night] = priceNights(adv, plans, RT, ["2026-10-15"], 1, 1, 2);
    expect(formatMoney(night!.amount!, 2)).toBe("99.00"); // (100 + 10) × 0.9 = 99
  });

  it("reports unpriced nights instead of guessing", () => {
    const [night] = priceNights(
      bar,
      new Map([["bar", bar]]),
      "other-type",
      ["2026-10-15"],
      1,
      0,
      2,
    );
    expect(night).toMatchObject({ amount: null, reason: "NO_SEASON" });
  });
});

describe("availability arithmetic", () => {
  const night = (overrides: Partial<NightInventory> = {}): NightInventory => ({
    date: "2026-10-10",
    physical: 10,
    outOfOrder: 1,
    sold: 6,
    tentative: 2,
    blocked: 0,
    overbookLimit: 0,
    sellLimit: null,
    ...overrides,
  });

  it("subtracts out-of-order and sold, ignores tentative, adds overbooking, caps by sell limit", () => {
    expect(availableForNight(night())).toBe(3);
    expect(availableForNight(night({ overbookLimit: 2 }))).toBe(5);
    expect(availableForNight(night({ sellLimit: 7 }))).toBe(1);
    expect(availableForNight(night({ blocked: 3 }))).toBe(0);
  });

  it("uses the tightest night of the stay", () => {
    expect(stayAvailability([night(), night({ sold: 9 }), night({ sold: 2 })])).toBe(0);
  });

  it("classifies room types", () => {
    expect(
      roomTypeStatus({ available: 3, requestedRooms: 2, occupancyFits: true, closed: false }),
    ).toBe("AVAILABLE");
    expect(
      roomTypeStatus({ available: 1, requestedRooms: 2, occupancyFits: true, closed: false }),
    ).toBe("LIMITED");
    expect(
      roomTypeStatus({ available: 0, requestedRooms: 1, occupancyFits: true, closed: false }),
    ).toBe("SOLD_OUT");
    expect(
      roomTypeStatus({ available: 5, requestedRooms: 1, occupancyFits: true, closed: true }),
    ).toBe("CLOSED");
    expect(
      roomTypeStatus({ available: 5, requestedRooms: 1, occupancyFits: false, closed: false }),
    ).toBe("NOT_SUITABLE");
  });
});

describe("restrictions", () => {
  const base = {
    roomTypeId: RT,
    ratePlanId: "bar",
    arrival: "2026-10-10",
    departure: "2026-10-12",
    nights: ["2026-10-10", "2026-10-11"],
    businessDate: "2026-10-01",
  };

  it("applies arrival, departure, stay-night and advance rules", () => {
    const rows = [
      {
        stayDate: "2026-10-10",
        type: "MIN_LOS" as const,
        roomTypeId: null,
        ratePlanId: null,
        value: 3,
      },
      {
        stayDate: "2026-10-12",
        type: "CLOSED_TO_DEPARTURE" as const,
        roomTypeId: RT,
        ratePlanId: null,
        value: null,
      },
      {
        stayDate: "2026-10-11",
        type: "CLOSED" as const,
        roomTypeId: null,
        ratePlanId: "bar",
        value: null,
      },
      {
        stayDate: "2026-10-10",
        type: "MIN_ADVANCE_DAYS" as const,
        roomTypeId: null,
        ratePlanId: null,
        value: 14,
      },
    ];
    expect(restrictionViolations({ ...base, rows }).map((v) => v.type)).toEqual([
      "MIN_LOS",
      "CLOSED_TO_DEPARTURE",
      "CLOSED",
      "MIN_ADVANCE_DAYS",
    ]);
  });

  it("ignores rules for other room types and other rate plans", () => {
    const rows = [
      {
        stayDate: "2026-10-10",
        type: "CLOSED" as const,
        roomTypeId: "other",
        ratePlanId: null,
        value: null,
      },
      {
        stayDate: "2026-10-10",
        type: "CLOSED" as const,
        roomTypeId: null,
        ratePlanId: "other-plan",
        value: null,
      },
      {
        stayDate: "2026-10-12",
        type: "CLOSED" as const,
        roomTypeId: null,
        ratePlanId: null,
        value: null,
      },
    ];
    expect(restrictionViolations({ ...base, rows })).toEqual([]);
  });
});
