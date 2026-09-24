import "server-only";
import type { Tx } from "@/lib/db/prisma";
import { AppError } from "@/lib/http/errors";
import { type MoneyUnits, average, formatMoney, sum } from "@/lib/utils/money";
import {
  type RestrictionRow,
  restrictionViolations,
} from "@/modules/availability/availability.policy";
import type { RateQuoteView } from "@/modules/availability/availability.types";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import { type RatePlanPricing, priceNights } from "./rates.policy";
import { type RatePlanRow, findCurrencyMinorUnits, findRatePlansForStay } from "./rates.repository";

/**
 * Rate quoting for a stay (Phase 2 scope). Plans that need a negotiated
 * account or a membership, and day-use plans, are not offered yet; they
 * arrive with profiles/loyalty and day-use handling.
 */

export interface StayRequest {
  propertyId: string;
  businessDate: string;
  arrival: string;
  departure: string;
  nights: string[];
  adults: number;
  children: number;
}

export interface LoadedRates {
  plans: RatePlanRow[];
  pricing: Map<string, RatePlanPricing>;
  minorUnits: number;
}

export async function loadRates(
  tx: Tx,
  stay: StayRequest,
  currencyCode: string,
): Promise<LoadedRates> {
  const lastNight = stay.nights.at(-1) ?? stay.arrival;
  const plans = await findRatePlansForStay(tx, stay.propertyId, stay.arrival, lastNight);
  const currency = await findCurrencyMinorUnits(tx, currencyCode);
  const pricing = new Map<string, RatePlanPricing>(plans.map((plan) => [plan.id, toPricing(plan)]));
  return { plans, pricing, minorUnits: currency?.minorUnits ?? 2 };
}

/** All offerable rate plans for one room type, bookable or not (with the reason). */
export function quoteRoomType(
  loaded: LoadedRates,
  stay: StayRequest,
  roomTypeId: string,
  restrictions: readonly RestrictionRow[],
  onlyRatePlanId?: string,
): RateQuoteView[] {
  return loaded.plans
    .filter((plan) => (onlyRatePlanId ? plan.id === onlyRatePlanId : true))
    .filter((plan) => isOfferable(plan, stay, roomTypeId))
    .map((plan) => quotePlan(loaded, plan, stay, roomTypeId, restrictions));
}

/**
 * Prices a stay for booking. Throws BUSINESS_RULE_VIOLATION when the rate
 * plan is not sellable for this room type and stay, or a night cannot be
 * priced. Restriction violations are returned so the caller can require an
 * override.
 */
export function priceForBooking(
  loaded: LoadedRates,
  stay: StayRequest,
  roomTypeId: string,
  ratePlanId: string,
  restrictions: readonly RestrictionRow[],
): { quote: RateQuoteView; nightly: { date: string; amount: MoneyUnits }[] } {
  const plan = loaded.plans.find((p) => p.id === ratePlanId);
  if (!plan || !isOfferable(plan, stay, roomTypeId)) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "This rate plan cannot be sold for the selected room type and dates",
      {
        reason: "RATE_NOT_SELLABLE",
      },
    );
  }
  const priced = priceNights(
    loaded.pricing.get(plan.id)!,
    loaded.pricing,
    roomTypeId,
    stay.nights,
    stay.adults,
    stay.children,
    loaded.minorUnits,
  );
  const nightly: { date: string; amount: MoneyUnits }[] = [];
  for (const night of priced) {
    if (night.amount === null) {
      throw new AppError("BUSINESS_RULE_VIOLATION", `No price is defined for ${night.date}`, {
        reason: "RATE_NOT_PRICED",
        date: night.date,
      });
    }
    nightly.push({ date: night.date, amount: night.amount });
  }
  return { quote: quotePlan(loaded, plan, stay, roomTypeId, restrictions), nightly };
}

function quotePlan(
  loaded: LoadedRates,
  plan: RatePlanRow,
  stay: StayRequest,
  roomTypeId: string,
  restrictions: readonly RestrictionRow[],
): RateQuoteView {
  const priced = priceNights(
    loaded.pricing.get(plan.id)!,
    loaded.pricing,
    roomTypeId,
    stay.nights,
    stay.adults,
    stay.children,
    loaded.minorUnits,
  );
  const amounts = priced.map((n) => n.amount);
  const complete = amounts.every((a): a is MoneyUnits => a !== null);
  const violations = restrictionViolations({
    rows: restrictions.filter((r) => r.ratePlanId === plan.id),
    roomTypeId,
    ratePlanId: plan.id,
    arrival: stay.arrival,
    departure: stay.departure,
    nights: stay.nights,
    businessDate: stay.businessDate,
  });
  const digits = loaded.minorUnits;
  return {
    ratePlan: { id: plan.id, code: plan.code, name: plan.name, kind: plan.kind },
    currencyCode: plan.currencyCode,
    taxInclusive: plan.taxInclusive,
    total: complete ? formatMoney(sum(amounts as MoneyUnits[]), digits) : null,
    averageNightly: complete ? formatMoney(average(amounts as MoneyUnits[], digits), digits) : null,
    nightly: priced.map((n) => ({
      date: n.date,
      amount: n.amount === null ? null : formatMoney(n.amount, digits),
    })),
    bookable: complete && violations.length === 0,
    unavailableReason: !complete ? "NOT_PRICED" : violations.length > 0 ? "RESTRICTED" : null,
    restrictions: violations,
    cancellationPolicy: plan.cancellationPolicy,
  };
}

function isOfferable(plan: RatePlanRow, stay: StayRequest, roomTypeId: string): boolean {
  if (plan.requiresNegotiation || plan.requiresMembership || plan.isDayUse) return false;
  if (!plan.roomTypes.some((rt) => rt.roomTypeId === roomTypeId)) return false;
  const lastNight = stay.nights.at(-1) ?? stay.arrival;
  if (plan.sellFrom && stay.businessDate < toDateOnly(plan.sellFrom)) return false;
  if (plan.sellTo && stay.businessDate > toDateOnly(plan.sellTo)) return false;
  if (plan.stayFrom && stay.arrival < toDateOnly(plan.stayFrom)) return false;
  if (plan.stayTo && lastNight > toDateOnly(plan.stayTo)) return false;
  return true;
}

function toPricing(plan: RatePlanRow): RatePlanPricing {
  return {
    id: plan.id,
    parentRatePlanId: plan.parentRatePlanId,
    derivationType: plan.derivationType,
    derivationValue: plan.derivationValue?.toFixed(4) ?? null,
    roundingIncrement: plan.roundingIncrement?.toFixed(4) ?? null,
    seasons: plan.seasons.map((season) => ({
      id: season.id,
      startDate: toDateOnly(season.startDate),
      endDate: toDateOnly(season.endDate),
      daysOfWeek: season.daysOfWeek,
      priority: season.priority,
      amounts: Object.fromEntries(
        season.amounts.map((a) => [
          a.roomTypeId,
          {
            oneAdult: a.oneAdult.toFixed(4),
            twoAdults: a.twoAdults?.toFixed(4) ?? null,
            threeAdults: a.threeAdults?.toFixed(4) ?? null,
            fourAdults: a.fourAdults?.toFixed(4) ?? null,
            extraAdult: a.extraAdult?.toFixed(4) ?? null,
            extraChild: a.extraChild?.toFixed(4) ?? null,
          },
        ]),
      ),
    })),
  };
}

/** Fraction digits of a currency (2 for PKR/AED, 3 for KWD). */
export async function currencyMinorUnits(tx: Tx, currencyCode: string): Promise<number> {
  return (await findCurrencyMinorUnits(tx, currencyCode))?.minorUnits ?? 2;
}
