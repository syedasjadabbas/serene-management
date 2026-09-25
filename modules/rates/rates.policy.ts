/**
 * Pure nightly pricing (isomorphic, unit-tested). Phase 2 scope: season
 * selection by priority and weekday, occupancy-based amounts, extra
 * adult/child, and derived rates (parent ± percent/amount, rounded).
 * Taxes, packages and discounts are applied by billing in later phases.
 */
import {
  type MoneyUnits,
  applyPercent,
  parseMoney,
  roundToIncrement,
  roundToMinorUnits,
} from "@/lib/utils/money";

export interface SeasonAmounts {
  oneAdult: string;
  twoAdults: string | null;
  threeAdults: string | null;
  fourAdults: string | null;
  extraAdult: string | null;
  extraChild: string | null;
}

export interface RateSeasonInput {
  id: string;
  /** Inclusive dates. */
  startDate: string;
  endDate: string;
  /** Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64. */
  daysOfWeek: number;
  priority: number;
  /** Amounts by room type id. */
  amounts: Record<string, SeasonAmounts>;
}

export interface RatePlanPricing {
  id: string;
  parentRatePlanId: string | null;
  derivationType: "PERCENT" | "AMOUNT" | null;
  derivationValue: string | null;
  roundingIncrement: string | null;
  seasons: RateSeasonInput[];
}

const WEEKDAY_BITS = [64, 1, 2, 4, 8, 16, 32]; // indexed by getUTCDay(): Sunday = 0

export function weekdayBit(date: string): number {
  return WEEKDAY_BITS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
}

/** Highest-priority season covering the date and weekday; ties go to the latest start. */
export function selectSeason(
  seasons: readonly RateSeasonInput[],
  date: string,
): RateSeasonInput | null {
  const bit = weekdayBit(date);
  let best: RateSeasonInput | null = null;
  for (const season of seasons) {
    if (date < season.startDate || date > season.endDate || (season.daysOfWeek & bit) === 0)
      continue;
    if (
      !best ||
      season.priority > best.priority ||
      (season.priority === best.priority && season.startDate > best.startDate)
    ) {
      best = season;
    }
  }
  return best;
}

/**
 * Occupancy price for one night, or null when the party cannot be priced.
 * Uses the highest defined occupancy column at or below the number of adults,
 * then adds extra adults and extra children.
 */
export function occupancyAmount(
  amounts: SeasonAmounts,
  adults: number,
  children: number,
): MoneyUnits | null {
  if (adults < 1) return null;
  const byAdults = [amounts.oneAdult, amounts.twoAdults, amounts.threeAdults, amounts.fourAdults];
  let covered = Math.min(adults, byAdults.length);
  while (covered > 1 && byAdults[covered - 1] == null) covered--;
  const extraAdults = adults - covered;
  if (extraAdults > 0 && amounts.extraAdult == null) return null;

  let amount = parseMoney(byAdults[covered - 1]!);
  if (extraAdults > 0) amount += BigInt(extraAdults) * parseMoney(amounts.extraAdult!);
  if (children > 0 && amounts.extraChild != null)
    amount += BigInt(children) * parseMoney(amounts.extraChild);
  return amount;
}

export type NightPrice =
  | { date: string; amount: MoneyUnits }
  | { date: string; amount: null; reason: "NO_SEASON" | "OCCUPANCY_NOT_PRICED" };

/**
 * Prices each night for a rate plan and room type. Derived plans take the
 * parent's price (recursively, max depth 3), apply the derivation and round.
 * Results are rounded to the currency's minor units.
 */
export function priceNights(
  plan: RatePlanPricing,
  plansById: ReadonlyMap<string, RatePlanPricing>,
  roomTypeId: string,
  nights: readonly string[],
  adults: number,
  children: number,
  minorUnits: number,
): NightPrice[] {
  return nights.map((date) => {
    const amount = priceOneNight(plan, plansById, roomTypeId, date, adults, children, 0);
    if (typeof amount === "string") return { date, amount: null, reason: amount };
    return { date, amount: roundToMinorUnits(amount, minorUnits) };
  });
}

function priceOneNight(
  plan: RatePlanPricing,
  plansById: ReadonlyMap<string, RatePlanPricing>,
  roomTypeId: string,
  date: string,
  adults: number,
  children: number,
  depth: number,
): MoneyUnits | "NO_SEASON" | "OCCUPANCY_NOT_PRICED" {
  if (plan.parentRatePlanId && plan.derivationType && plan.derivationValue !== null) {
    const parent = plansById.get(plan.parentRatePlanId);
    if (!parent || depth >= 3) return "NO_SEASON";
    const parentAmount = priceOneNight(
      parent,
      plansById,
      roomTypeId,
      date,
      adults,
      children,
      depth + 1,
    );
    if (typeof parentAmount === "string") return parentAmount;
    const value = parseMoney(plan.derivationValue);
    const derived =
      plan.derivationType === "PERCENT" ? applyPercent(parentAmount, value) : parentAmount + value;
    const rounded = roundToIncrement(
      derived,
      plan.roundingIncrement ? parseMoney(plan.roundingIncrement) : null,
    );
    return rounded < 0n ? 0n : rounded;
  }
  const season = selectSeason(plan.seasons, date);
  const amounts = season?.amounts[roomTypeId];
  if (!season || !amounts) return "NO_SEASON";
  return occupancyAmount(amounts, adults, children) ?? "OCCUPANCY_NOT_PRICED";
}

// --- Administration rules (Phase 6) ------------------------------------------------------

export interface SeasonWindow {
  startDate: string;
  endDate: string;
  daysOfWeek: number;
  priority: number;
}

/**
 * Two seasons of one plan are ambiguous when they share a priority and a
 * stay date on which both apply (overlapping dates and weekday). Such a pair
 * is rejected, so `selectSeason` always has a single winner: the highest
 * priority season covering the date and weekday.
 */
export function seasonsConflict(a: SeasonWindow, b: SeasonWindow): boolean {
  if (a.priority !== b.priority) return false;
  const from = a.startDate > b.startDate ? a.startDate : b.startDate;
  const to = a.endDate < b.endDate ? a.endDate : b.endDate;
  if (from > to) return false;
  const shared = a.daysOfWeek & b.daysOfWeek;
  if (shared === 0) return false;
  // A week of overlap contains every weekday; shorter overlaps are checked day by day.
  let date = from;
  for (let i = 0; i < 7 && date <= to; i++) {
    if ((weekdayBit(date) & shared) !== 0) return true;
    date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return false;
}

/**
 * Why a plan cannot derive from `parentId` (null = allowed): self-reference,
 * a cycle through the plan's own descendants, an inactive parent, or a chain
 * deeper than the 3 derivation steps `priceNights` resolves. The database
 * trigger `rate_plans_guard` enforces the same rules.
 */
export function derivationProblem(
  plans: readonly { id: string; parentRatePlanId: string | null; status: string }[],
  planId: string | null,
  parentId: string,
): string | null {
  if (planId && parentId === planId) return "A rate plan cannot derive from itself";
  const byId = new Map(plans.map((p) => [p.id, p]));
  const parent = byId.get(parentId);
  if (!parent) return "The parent rate plan does not exist";
  if (parent.status !== "ACTIVE") return "The parent rate plan is not active";
  let ancestors = 0;
  for (
    let cursor: string | null = parentId;
    cursor;
    cursor = byId.get(cursor)?.parentRatePlanId ?? null
  ) {
    if (cursor === planId) return "This would make the rate plan derive from itself";
    ancestors += 1;
    if (ancestors > 3) return "Derived rates may be at most 3 levels deep";
  }
  const depthBelow = (id: string, depth: number): number => {
    if (depth > 5) return depth;
    const children = plans.filter((p) => p.parentRatePlanId === id);
    return children.reduce((max, child) => Math.max(max, depthBelow(child.id, depth + 1)), depth);
  };
  if (planId && ancestors + depthBelow(planId, 0) > 3) {
    return "Derived rates may be at most 3 levels deep";
  }
  return null;
}
