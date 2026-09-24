/**
 * Exact decimal money arithmetic on bigint "units" of 1/10 000 (the precision
 * of NUMERIC(19,4) columns). Isomorphic and dependency-free. Values cross the
 * API as decimal strings; JavaScript numbers are never used for money.
 */

export type MoneyUnits = bigint;

const SCALE_DIGITS = 4;
const SCALE = 10_000n;
const DECIMAL = /^(-)?(\d{1,15})(?:\.(\d{1,4}))?$/;

export function parseMoney(value: string): MoneyUnits {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new RangeError(`Invalid decimal amount "${value}"`);
  const [, sign, whole = "0", fraction = ""] = match;
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, "0"));
  return sign ? -units : units;
}

/** Decimal string with 4 fraction digits (the storage representation). */
export function formatMoney(units: MoneyUnits, fractionDigits = SCALE_DIGITS): string {
  const rounded = roundUnits(units, 10n ** BigInt(SCALE_DIGITS - fractionDigits));
  const negative = rounded < 0n;
  const abs = negative ? -rounded : rounded;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(SCALE_DIGITS, "0").slice(0, fractionDigits);
  return `${negative ? "-" : ""}${whole}${fractionDigits > 0 ? `.${fraction}` : ""}`;
}

/** Division rounding half away from zero. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n + d / 2n) / d;
  return negative ? -quotient : quotient;
}

/** Rounds to a multiple of `step` units (half away from zero). */
function roundUnits(units: MoneyUnits, step: bigint): MoneyUnits {
  if (step <= 1n) return units;
  return divideHalfUp(units, step) * step;
}

/** Units of one minor currency unit (e.g. 100n = 0.01 for 2 minor units). */
export function minorUnitStep(minorUnits: number): bigint {
  return 10n ** BigInt(Math.max(0, SCALE_DIGITS - minorUnits));
}

/** True when the amount has no precision beyond the currency's minor units. */
export function isMinorUnitAligned(units: MoneyUnits, minorUnits: number): boolean {
  return units % minorUnitStep(minorUnits) === 0n;
}

/** Rounds to the currency's minor units (e.g. 2 for PKR, 3 for KWD). */
export function roundToMinorUnits(units: MoneyUnits, minorUnits: number): MoneyUnits {
  return roundUnits(units, 10n ** BigInt(Math.max(0, SCALE_DIGITS - minorUnits)));
}

/** Rounds to a configured increment (e.g. "1.0000" → whole currency units). */
export function roundToIncrement(units: MoneyUnits, increment: MoneyUnits | null): MoneyUnits {
  return increment && increment > 0n ? roundUnits(units, increment) : units;
}

/** units × (100 + percent) / 100, where percent is itself in money units (e.g. -10.0000). */
export function applyPercent(units: MoneyUnits, percentUnits: MoneyUnits): MoneyUnits {
  return divideHalfUp(units * (100n * SCALE + percentUnits), 100n * SCALE);
}

export function multiply(units: MoneyUnits, quantity: number): MoneyUnits {
  if (!Number.isInteger(quantity)) throw new RangeError("Quantity must be an integer");
  return units * BigInt(quantity);
}

export function sum(values: readonly MoneyUnits[]): MoneyUnits {
  return values.reduce((total, value) => total + value, 0n);
}

/** Average rounded to minor units — for display only, never for postings. */
export function average(values: readonly MoneyUnits[], minorUnits: number): MoneyUnits {
  if (values.length === 0) return 0n;
  return roundToMinorUnits(divideHalfUp(sum(values), BigInt(values.length)), minorUnits);
}
