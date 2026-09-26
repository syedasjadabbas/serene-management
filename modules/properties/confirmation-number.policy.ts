/**
 * Confirmation numbers (D36). Since Phase 9 a property issues
 * "<PREFIX>-<number>" ("SMR-100045"); numbers issued earlier are plain digits
 * ("100029") and are never renumbered. A share suffix ("-2") may follow either
 * form when staff type what they see on a shared reservation.
 */

/** Same pattern as a property code: the prefix defaults to the code. */
export const CONFIRMATION_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

const CONFIRMATION_PATTERN = /^(?:([A-Z][A-Z0-9]{1,9})-)?(\d{4,12})(?:-(\d{1,3}))?$/;

export interface ParsedConfirmation {
  /** Upper-case prefix, or null when only the number was typed. */
  prefix: string | null;
  /** The digits, without the prefix or share suffix. */
  number: string;
}

export function formatConfirmationNumber(prefix: string, value: bigint | number): string {
  return `${prefix}-${value.toString()}`;
}

/**
 * Reads a typed confirmation number. Returns null when the text cannot be a
 * confirmation number (the caller then treats it as a name search).
 */
export function parseConfirmationNumber(raw: string): ParsedConfirmation | null {
  const match = CONFIRMATION_PATTERN.exec(raw.trim().toUpperCase());
  if (!match) return null;
  return { prefix: match[1] ?? null, number: match[2]! };
}

/**
 * The stored confirmation numbers a parsed search can match: the exact
 * prefixed number, or — when only digits were typed — the legacy plain
 * number and any prefixed number ending in those digits.
 */
export function confirmationCandidates(parsed: ParsedConfirmation): {
  equals: string[];
  endsWith: string | null;
} {
  if (parsed.prefix) return { equals: [`${parsed.prefix}-${parsed.number}`], endsWith: null };
  return { equals: [parsed.number], endsWith: `-${parsed.number}` };
}
