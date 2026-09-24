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
