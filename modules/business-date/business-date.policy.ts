/**
 * Pure business-date and property-time rules (isomorphic, unit-tested).
 *
 * Business dates and stay dates are "YYYY-MM-DD" strings. They are never
 * derived from the browser clock: the hotel business date is the property's
 * current `business_dates` row, and "local date/time" always means the
 * property's IANA time zone, not the server's or the user's.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function partsInZone(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** Calendar date at the property for an instant, e.g. "2026-09-25". */
export function localDateInZone(instant: Date, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock time at the property for an instant, "HH:MM" (24h). */
export function localTimeInZone(instant: Date, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** A PostgreSQL DATE value (read as UTC midnight) as "YYYY-MM-DD". */
export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight, the representation Prisma uses for DATE columns. */
export function fromDateOnly(value: string): Date {
  if (!isDateOnly(value)) throw new RangeError(`Invalid date "${value}"`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function addDays(date: string, days: number): string {
  return toDateOnly(new Date(fromDateOnly(date).getTime() + days * MS_PER_DAY));
}

/**
 * The property's local date and time `elapsedMs` after the server reported
 * them (`time` "HH:MM"). Anchored to the server's value, not the browser
 * clock; the client re-reads the server value regularly (DST, drift).
 */
export function advancePropertyTime(
  date: string,
  time: string,
  elapsedMs: number,
): { date: string; time: string } {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const total = hours * 60 + minutes + Math.max(0, Math.floor(elapsedMs / 60_000));
  const days = Math.floor(total / 1440);
  const within = total % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: days ? addDays(date, days) : date,
    time: `${pad(Math.floor(within / 60))}:${pad(within % 60)}`,
  };
}

/**
 * Milliseconds until safely past the property's next local midnight, from a
 * server time "HH:MM" read `elapsedMs` ago (the minute's seconds are unknown,
 * so the result errs late, never early).
 */
export function msUntilAfterLocalMidnight(time: string, elapsedMs: number): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const remaining = (1440 - (hours * 60 + minutes)) * 60_000 - elapsedMs;
  return Math.max(0, remaining) + 5_000;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateOnly(to).getTime() - fromDateOnly(from).getTime()) / MS_PER_DAY);
}

/**
 * How the business date relates to the property's calendar date:
 * - IN_SYNC: same day.
 * - AWAITING_AUDIT: calendar is one day ahead — normal between local midnight
 *   and the night audit.
 * - AUDIT_OVERDUE: two or more days behind — night audit has been missed.
 * - AHEAD: business date is later than the calendar (misconfiguration).
 */
export type BusinessDateSyncState = "IN_SYNC" | "AWAITING_AUDIT" | "AUDIT_OVERDUE" | "AHEAD";

export function businessDateSync(businessDate: string, propertyLocalDate: string) {
  const lagDays = daysBetween(businessDate, propertyLocalDate);
  const state: BusinessDateSyncState =
    lagDays === 0
      ? "IN_SYNC"
      : lagDays === 1
        ? "AWAITING_AUDIT"
        : lagDays > 1
          ? "AUDIT_OVERDUE"
          : "AHEAD";
  return { lagDays, state };
}

/**
 * Go-live: the first business date must be the property's local calendar date
 * or the day before it (going live after midnight, before the first audit).
 */
export function isAcceptableInitialBusinessDate(date: string, propertyLocalDate: string): boolean {
  const lag = daysBetween(date, propertyLocalDate);
  return lag === 0 || lag === 1;
}

/** Offset of a time zone from UTC at an instant, in minutes (e.g. +300 for Asia/Karachi). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
  );
  const floored = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - floored) / 60_000);
}

/**
 * The UTC instant at which a property-local calendar day starts
 * (e.g. "created on 2026-10-10" in Asia/Karachi → 2026-10-09T19:00:00Z).
 * Re-checks the offset once to land correctly across DST transitions.
 */
export function localMidnightUtc(date: string, timeZone: string): Date {
  const naive = fromDateOnly(date).getTime();
  let instant = naive - timeZoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  const corrected = naive - timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}
