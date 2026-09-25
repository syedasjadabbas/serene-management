import { describe, expect, it } from "vitest";
import { parseMoney } from "@/lib/utils/money";
import {
  allocationProblem,
  blockTotals,
  blockTransitionProblem,
  remainingRooms,
  stayWithinBlock,
} from "@/modules/groups/groups.policy";
import { createBlockSchema, pickupSchema } from "@/modules/groups/groups.schema";
import { setRestrictionsSchema } from "@/modules/availability/availability.schema";
import {
  type RatePlanPricing,
  derivationProblem,
  priceNights,
  seasonsConflict,
  selectSeason,
} from "@/modules/rates/rates.policy";
import { createRatePlanSchema, seasonSchema } from "@/modules/rates/rates.schema";

const ID = "01900000-0000-7000-8000-000000000001";
const season = (over: Partial<Parameters<typeof seasonsConflict>[0]> = {}) => ({
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  daysOfWeek: 127,
  priority: 0,
  ...over,
});

describe("season precedence", () => {
  it("rejects same-priority seasons that share a stay date and weekday", () => {
    expect(
      seasonsConflict(season(), season({ startDate: "2026-10-15", endDate: "2026-11-15" })),
    ).toBe(true);
    // Different priority: the higher one wins, no ambiguity.
    expect(seasonsConflict(season(), season({ priority: 10 }))).toBe(false);
    // No shared dates.
    expect(
      seasonsConflict(season(), season({ startDate: "2026-11-01", endDate: "2026-11-30" })),
    ).toBe(false);
    // Weekday split: Mon–Thu vs Fri–Sun never overlap.
    expect(
      seasonsConflict(season({ daysOfWeek: 1 | 2 | 4 | 8 }), season({ daysOfWeek: 16 | 32 | 64 })),
    ).toBe(false);
    // A one-day overlap on a Friday conflicts only if both apply on Fridays.
    const friday = { startDate: "2026-10-02", endDate: "2026-10-02" };
    expect(seasonsConflict(season(), season({ ...friday, daysOfWeek: 16 }))).toBe(true);
    expect(seasonsConflict(season(), season({ ...friday, daysOfWeek: 32 }))).toBe(false);
  });

  it("resolves overlapping seasons by priority (the engine's single rule)", () => {
    const seasons = [
      {
        id: "base",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        daysOfWeek: 127,
        priority: 0,
        amounts: {},
      },
      {
        id: "event",
        startDate: "2026-10-10",
        endDate: "2026-10-12",
        daysOfWeek: 127,
        priority: 50,
        amounts: {},
      },
    ];
    expect(selectSeason(seasons, "2026-10-09")?.id).toBe("base");
    expect(selectSeason(seasons, "2026-10-11")?.id).toBe("event");
    expect(selectSeason(seasons, "2026-11-01")).toBeNull();
  });
});

describe("derived rates", () => {
  const plans = [
    { id: "bar", parentRatePlanId: null, status: "ACTIVE" },
    { id: "corp", parentRatePlanId: "bar", status: "ACTIVE" },
    { id: "member", parentRatePlanId: "corp", status: "ACTIVE" },
    { id: "staff", parentRatePlanId: "member", status: "ACTIVE" },
    { id: "old", parentRatePlanId: null, status: "INACTIVE" },
  ];

  it("allows chains up to three derivation steps", () => {
    expect(derivationProblem(plans, null, "bar")).toBeNull();
    expect(derivationProblem(plans, null, "member")).toBeNull();
    expect(derivationProblem(plans, null, "staff")).toMatch(/3 levels/);
  });

  it("rejects self-reference, cycles and inactive parents", () => {
    expect(derivationProblem(plans, "bar", "bar")).toMatch(/itself/);
    expect(derivationProblem(plans, "bar", "corp")).toMatch(/itself/);
    expect(derivationProblem(plans, null, "old")).toMatch(/not active/);
    expect(derivationProblem(plans, null, "missing")).toMatch(/does not exist/);
  });

  it("counts the plan's own descendants when it is re-parented", () => {
    // corp has member → staff below it (2 levels); under another derived plan it would be 4 deep.
    const more = [...plans, { id: "promo", parentRatePlanId: "bar", status: "ACTIVE" }];
    expect(derivationProblem(more, "corp", "promo")).toMatch(/3 levels/);
  });

  it("prices a derived plan from its parent with exact decimal rounding", () => {
    const bar: RatePlanPricing = {
      id: "bar",
      parentRatePlanId: null,
      derivationType: null,
      derivationValue: null,
      roundingIncrement: null,
      seasons: [
        {
          id: "s",
          startDate: "2026-10-01",
          endDate: "2026-10-31",
          daysOfWeek: 127,
          priority: 0,
          amounts: {
            rt: {
              oneAdult: "10000.00",
              twoAdults: "12000.00",
              threeAdults: null,
              fourAdults: null,
              extraAdult: null,
              extraChild: null,
            },
          },
        },
      ],
    };
    const group: RatePlanPricing = {
      ...bar,
      id: "grp",
      parentRatePlanId: "bar",
      derivationType: "PERCENT",
      derivationValue: "-15",
      roundingIncrement: "1",
      seasons: [],
    };
    const byId = new Map([
      ["bar", bar],
      ["grp", group],
    ]);
    const [night] = priceNights(group, byId, "rt", ["2026-10-05"], 2, 0, 2);
    expect(night!.amount).toBe(parseMoney("10200.00")); // 12000 × 0.85
  });
});

describe("group blocks", () => {
  it("follows the block status table", () => {
    expect(blockTransitionProblem("INQUIRY", "DEDUCT", 0)).toBeNull();
    expect(blockTransitionProblem("NON_DEDUCT", "DEDUCT", 0)).toBeNull();
    expect(blockTransitionProblem("DEDUCT", "NON_DEDUCT", 0)).toBeNull();
    expect(blockTransitionProblem("DEDUCT", "CANCEL", 2)).toMatch(/picked-up/);
    expect(blockTransitionProblem("DEDUCT", "INQUIRY", 0)).toMatch(/cannot become/);
    expect(blockTransitionProblem("CANCEL", "DEDUCT", 0)).toMatch(/cancelled/);
    expect(blockTransitionProblem("DEDUCT", "DEDUCT", 3)).toBeNull();
  });

  it("computes what a block still holds and never goes negative", () => {
    expect(remainingRooms({ allocated: 5, released: 1, pickedUp: 2 })).toBe(2);
    expect(remainingRooms({ allocated: 5, released: 0, pickedUp: 7 })).toBe(0); // elastic overflow
    expect(
      blockTotals([
        { date: "a", allocated: 5, released: 0, pickedUp: 2 },
        { date: "b", allocated: 5, released: 3, pickedUp: 2 },
      ]),
    ).toEqual({ allocated: 10, released: 3, pickedUp: 4, remaining: 3 });
  });

  it("never lets an allocation drop below pickup (non-elastic) or releases", () => {
    expect(allocationProblem({ allocated: 3, released: 0, pickedUp: 3 }, false)).toBeNull();
    expect(allocationProblem({ allocated: 2, released: 0, pickedUp: 3 }, false)).toMatch(
      /picked up/,
    );
    expect(allocationProblem({ allocated: 2, released: 0, pickedUp: 3 }, true)).toBeNull();
    expect(allocationProblem({ allocated: 1, released: 2, pickedUp: 0 }, true)).toMatch(/released/);
  });

  it("keeps a pickup inside the block's dates", () => {
    const block = { startDate: "2026-10-10", endDate: "2026-10-13" };
    expect(stayWithinBlock(block, { arrival: "2026-10-10", departure: "2026-10-13" })).toBe(true);
    expect(stayWithinBlock(block, { arrival: "2026-10-11", departure: "2026-10-12" })).toBe(true);
    expect(stayWithinBlock(block, { arrival: "2026-10-09", departure: "2026-10-12" })).toBe(false);
    expect(stayWithinBlock(block, { arrival: "2026-10-11", departure: "2026-10-14" })).toBe(false);
  });
});

describe("contracts never accept client prices or pickup counts", () => {
  it("rejects smuggled totals and derived values", () => {
    const pickup = {
      guestId: ID,
      roomTypeId: ID,
      arrival: "2026-10-10",
      departure: "2026-10-12",
      adults: 1,
    };
    expect(pickupSchema.safeParse(pickup).success).toBe(true);
    for (const extra of [
      { ratePlanId: ID },
      { total: "1" },
      { pickedUp: 3 },
      { rateAmount: "1" },
    ]) {
      expect(pickupSchema.safeParse({ ...pickup, ...extra }).success).toBe(false);
    }
    const block = {
      code: "B1",
      name: "Block",
      statusId: ID,
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      ratePlanId: ID,
      allocations: [{ roomTypeId: ID, rooms: 5 }],
    };
    expect(createBlockSchema.safeParse(block).success).toBe(true);
    expect(createBlockSchema.safeParse({ ...block, endDate: "2026-10-10" }).success).toBe(false);
    expect(createBlockSchema.safeParse({ ...block, override: true }).success).toBe(false); // no reason
  });

  it("validates rate and restriction commands", () => {
    const plan = {
      code: "corp",
      name: "Corporate",
      kind: "CORPORATE",
      taxInclusive: false,
      roomTransactionCodeId: ID,
      derivation: { parentRatePlanId: ID, type: "PERCENT", value: "-10" },
      roomTypeIds: [ID],
      reason: "New corporate rate",
    };
    const parsed = createRatePlanSchema.safeParse(plan);
    expect(parsed.success && parsed.data.code).toBe("CORP");
    expect(createRatePlanSchema.safeParse({ ...plan, currencyCode: "USD" }).success).toBe(false);
    expect(createRatePlanSchema.safeParse({ ...plan, reason: undefined }).success).toBe(false);
    expect(
      seasonSchema.safeParse({
        version: 1,
        name: "S",
        startDate: "2026-10-10",
        endDate: "2026-10-01",
        daysOfWeek: 127,
        priority: 0,
        amounts: [{ roomTypeId: ID, oneAdult: "100" }],
        reason: "Prices",
      }).success,
    ).toBe(false);
    const restriction = {
      action: "set",
      type: "MIN_LOS",
      from: "2026-10-01",
      to: "2026-10-07",
      value: 2,
      reason: "Event weekend",
    };
    expect(setRestrictionsSchema.safeParse(restriction).success).toBe(true);
    expect(setRestrictionsSchema.safeParse({ ...restriction, value: null }).success).toBe(false);
    expect(
      setRestrictionsSchema.safeParse({ ...restriction, type: "CLOSED", value: 2 }).success,
    ).toBe(false);
  });
});
