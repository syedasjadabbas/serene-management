import { type MoneyUnits, divideHalfUp, formatMoney } from "@/lib/utils/money";

/**
 * Hotel KPIs (docs/DATABASE_DESIGN.md §8), computed from counts and ledger
 * sums at query time and never stored. Exact arithmetic: money in bigint
 * units, percentages as decimal strings with two digits (half away from zero).
 *
 *   available = physical − out of order        (out of service stays sellable inventory)
 *   occupancy = rooms sold ÷ available × 100
 *   paying    = rooms sold − complimentary − house use
 *   ADR       = room revenue ÷ paying rooms sold
 *   RevPAR    = room revenue ÷ available rooms
 */

export interface RoomNightFacts {
  physical: number;
  outOfOrder: number;
  sold: number;
  complimentary: number;
  houseUse: number;
}

export function availableRooms(facts: RoomNightFacts): number {
  return Math.max(0, facts.physical - facts.outOfOrder);
}

export function payingRooms(facts: RoomNightFacts): number {
  return Math.max(0, facts.sold - facts.complimentary - facts.houseUse);
}

/** numerator ÷ denominator × 100 with two decimals; "0.00" when nothing is available. */
export function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.00";
  const hundredths = divideHalfUp(BigInt(numerator) * 10_000n, BigInt(denominator));
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Money per room (ADR, RevPAR): 4-digit decimal string; "0.0000" for zero rooms. */
export function perRoom(revenue: MoneyUnits, rooms: number): string {
  if (rooms <= 0) return formatMoney(0n);
  return formatMoney(divideHalfUp(revenue, BigInt(rooms)));
}

export function occupancy(facts: RoomNightFacts): string {
  return percent(facts.sold, availableRooms(facts));
}

export function adr(facts: RoomNightFacts, roomRevenue: MoneyUnits): string {
  return perRoom(roomRevenue, payingRooms(facts));
}

export function revpar(facts: RoomNightFacts, roomRevenue: MoneyUnits): string {
  return perRoom(roomRevenue, availableRooms(facts));
}

/** Longest date range a report accepts (inclusive days). */
export const MAX_REPORT_DAYS = 366;
