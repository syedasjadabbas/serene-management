import { counter } from "@/lib/observability/metrics";
import { swr } from "@/lib/cache";

/**
 * Cache for expensive report reads over CLOSED business dates only.
 *
 * Why this is safe (docs/ARCHITECTURE.md §12 "No cache for money or inventory"):
 * a business date before the property's current one is closed. The database
 * freezes closed `business_dates`, ledgers accept inserts only for the current
 * date, and `daily_statistics` snapshots are append-only. So a result computed
 * entirely from dates < the current business date cannot change. A range that
 * touches the open date (or later) is never cached and always reads live.
 *
 * Staleness that remains and is accepted: a rename of a room type, rate plan,
 * transaction code or guest can change a label inside a cached result for up
 * to FRESH + STALE (15 min). Amounts never change.
 *
 * Night audit recover/reopen reopens only the date being audited, which is
 * the open date and so never cached. The property's current business date is
 * part of every key anyway, so a date change produces new keys.
 *
 * Keys carry every input that changes the output, including the caller's
 * visibility flags, so one user never receives another user's redaction level.
 */

export const REPORT_CACHE_PREFIX = "rpt:v1:";
/** Fresh window: served as is. */
export const REPORT_CACHE_FRESH_MS = 5 * 60_000;
/** Stale window after FRESH: served while one background refresh runs. */
export const REPORT_CACHE_STALE_MS = 10 * 60_000;
/** Largest row count of a full report result that is stored (memory bound). */
export const REPORT_CACHE_MAX_ROWS = 2_000;

/**
 * Reports computed only from the immutable ledger and the daily statistics
 * snapshots. Row-level reports over mutable tables (arrivals, departures,
 * no-shows, cancellations, housekeeping, audit trail, payments with later
 * voids, live state) are deliberately not cached.
 */
export const CACHEABLE_REPORT_KEYS: ReadonlySet<string> = new Set([
  "manager-flash",
  "occupancy",
  "room-type-performance",
  "revenue-by-code",
  "tax",
  "package-revenue",
  "ledger-roll-forward",
]);

const lookups = counter("serene_report_cache_total", "Closed-range report cache lookups");

/** The whole range lies before the open business date (every date closed). */
export function isClosedRange(to: string, businessDate: string): boolean {
  return to < businessDate;
}

export function isCacheableReport(key: string, to: string, businessDate: string): boolean {
  return CACHEABLE_REPORT_KEYS.has(key) && isClosedRange(to, businessDate);
}

export interface ReportCacheKeyParts {
  propertyId: string;
  reportKey: string;
  businessDate: string;
  from: string;
  to: string;
  roomTypeId?: string | null;
  risk?: string | null;
  currencyCode: string;
  /** reports:financial: changes redaction of the result. */
  financial: boolean;
  /** reports:export: part of the returned result. */
  canExport: boolean;
}

/** Deterministic: parameters are emitted in a fixed (sorted) order. */
export function buildReportCacheKey(p: ReportCacheKeyParts): string {
  const params: [string, string][] = [
    ["bd", p.businessDate],
    ["cur", p.currencyCode],
    ["exp", p.canExport ? "1" : "0"],
    ["fin", p.financial ? "1" : "0"],
    ["from", p.from],
    ["risk", p.risk ?? ""],
    ["rt", p.roomTypeId ?? ""],
    ["to", p.to],
  ];
  return `${REPORT_CACHE_PREFIX}rep:${p.propertyId}:${p.reportKey}:${params
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`;
}

/** Key of the closed daily-statistics window of one property. */
export function buildStatisticsCacheKey(
  propertyId: string,
  businessDate: string,
  from: string,
  to: string,
): string {
  return `${REPORT_CACHE_PREFIX}stats:${propertyId}:bd=${businessDate}&from=${from}&to=${to}`;
}

/**
 * Stale-while-revalidate with single flight for a closed-range read. The
 * caller must have checked `isClosedRange`; the loader runs on a miss.
 */
export async function cachedClosedRead<T>(
  kind: "report" | "statistics",
  key: string,
  loader: () => Promise<T>,
  shouldCache?: (value: T) => boolean,
): Promise<T> {
  let loaded = false;
  const value = await swr(
    key,
    REPORT_CACHE_FRESH_MS,
    () => {
      loaded = true;
      return loader();
    },
    REPORT_CACHE_STALE_MS,
    {
      memoryMaxTtlMs: REPORT_CACHE_FRESH_MS + REPORT_CACHE_STALE_MS,
      ...(shouldCache ? { shouldCache } : {}),
    },
  );
  lookups.inc({ kind, result: loaded ? "miss" : "hit" });
  return value;
}
