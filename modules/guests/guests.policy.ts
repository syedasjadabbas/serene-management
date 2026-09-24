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
