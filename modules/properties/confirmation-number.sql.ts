import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { parseConfirmationNumber } from "./confirmation-number.policy";

/** Escapes LIKE wildcards so typed text is matched literally. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * SQL match of a typed confirmation number against a stored confirmation
 * column (D36), the same rules as the reservation list search: case does not
 * matter, a prefixed number ("smr-100045", also with a share suffix "-2")
 * matches that property's number, bare digits match the legacy plain number
 * and any prefixed number with those digits, anything else is a prefix of
 * the upper-cased text.
 */
export function confirmationMatchSql(column: Prisma.Sql, raw: string): Prisma.Sql {
  const parsed = parseConfirmationNumber(raw);
  if (!parsed) return Prisma.sql`${column} LIKE ${`${likeLiteral(raw.trim().toUpperCase())}%`}`;
  if (parsed.prefix) {
    return Prisma.sql`${column} LIKE ${`${parsed.prefix}-${parsed.number}%`}`;
  }
  return Prisma.sql`(${column} LIKE ${`${parsed.number}%`} OR ${column} LIKE ${`%-${parsed.number}%`})`;
}
