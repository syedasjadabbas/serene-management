/**
 * Guest name normalization for search (isomorphic). `search_name` stores the
 * normalized "last first" so one trigram index serves both name orders.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+\-' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function guestSearchName(firstName: string, lastName: string): string {
  return normalizeName(`${lastName} ${firstName}`);
}

export function guestFullName(guest: {
  title?: string | null;
  firstName: string;
  lastName: string;
}): string {
  return [guest.title, guest.firstName, guest.lastName].filter(Boolean).join(" ");
}

/** Digits of a phone number (search key); null when there are none. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Name used to address the guest: preferred name when set. */
export function guestDisplayName(guest: {
  preferredName?: string | null;
  firstName: string;
  lastName: string;
}): string {
  return `${guest.preferredName || guest.firstName} ${guest.lastName}`;
}

export type NoteVisibility = "ALL_STAFF" | "MANAGEMENT" | "INTERNAL";

/**
 * Who may read a guest note. ALL_STAFF notes need guests:read; management
 * and internal notes are restricted notes (guests:read_sensitive).
 */
export function noteVisible(visibility: NoteVisibility, canReadSensitive: boolean): boolean {
  return visibility === "ALL_STAFF" || canReadSensitive;
}

/** A date of birth is a past calendar date after 1900 (both YYYY-MM-DD). */
export function dateOfBirthProblem(dateOfBirth: string, today: string): string | null {
  if (dateOfBirth >= today) return "Date of birth must be in the past";
  if (dateOfBirth < "1900-01-01") return "Date of birth is too far in the past";
  return null;
}

/**
 * At most one primary entry per type in a contact list (e.g. one primary
 * email and one primary mobile). Returns the first duplicated type.
 */
export function duplicatePrimary<T extends { type: string; isPrimary: boolean }>(
  items: readonly T[],
): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.isPrimary) continue;
    if (seen.has(item.type)) return item.type;
    seen.add(item.type);
  }
  return null;
}

/** Same contact value listed twice (case-insensitive for e-mail). */
export function duplicateContactValue(
  items: readonly { type: string; value: string }[],
): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.type}:${item.type === "EMAIL" ? item.value.toLowerCase() : (phoneDigits(item.value) ?? item.value)}`;
    if (seen.has(key)) return item.value;
    seen.add(key);
  }
  return null;
}
