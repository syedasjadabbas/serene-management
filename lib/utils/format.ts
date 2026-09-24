/**
 * Display formatting (isomorphic). Money arrives as decimal strings and is
 * passed to Intl as a string, so no precision is lost through JS numbers.
 * Calendar dates ("YYYY-MM-DD") are formatted in UTC so they never shift
 * with the browser's time zone.
 */

export function formatCurrency(
  amount: string | null | undefined,
  currency: string,
  locale = "en",
  /** Fixed fraction digits (e.g. the currency's configured minor units for ledgers). */
  fractionDigits?: number,
): string {
  if (amount == null) return "—";
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    ...(fractionDigits === undefined
      ? {}
      : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }),
  });
  // Intl accepts decimal strings exactly (ECMA-402 "StringNumericLiteral").
  return formatter.format(amount as unknown as number);
}

export function formatDate(date: string | null | undefined, locale = "en"): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

export function formatShortDate(date: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/** An instant shown in the property's time zone. */
export function formatDateTime(iso: string, timeZone: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
