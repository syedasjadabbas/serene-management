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

/**
 * Most rows one report run may produce (H10). Row-level reads ask the
 * database for one more; a larger result is refused (narrow the range)
 * rather than held in memory or silently cut, so totals are always complete.
 */
export const REPORT_ROW_LIMIT = 20_000;

/**
 * Reports that read the most rows over their widest range (measured on the
 * benchmark data, 366 days: 0.5-3.1 million rows each, docs/SCALABILITY.md
 * §33). Each process computes at most REPORT_HEAVY_CONCURRENCY of them at a
 * time, so a few users exporting them cannot take the database from
 * everyone else. Every other report runs freely.
 */
export const HEAVY_REPORT_KEYS: ReadonlySet<string> = new Set([
  "guest-ledger",
  "ledger-roll-forward",
  "cancellations",
  "arrivals",
  "departures",
  "revenue-by-code",
]);

/**
 * Reports that show the property's current state whatever range is asked
 * (in-house guests, room status): never read from a replica.
 */
export const LIVE_REPORT_KEYS: ReadonlySet<string> = new Set(["in-house", "room-status"]);

/** Rows per JSON page (the CSV export always carries every row). */
export const REPORT_PAGE_SIZE = 500;
export const REPORT_PAGE_MAX = 1_000;
