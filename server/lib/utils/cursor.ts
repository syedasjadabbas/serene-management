/**
 * Opaque keyset-pagination cursor: base64url(JSON) of the last row's sort key
 * and id. Decoding never throws; an invalid cursor yields null (→ 400 upstream).
 *
 * Cursors come back from clients, so every value is checked against the type
 * the query will compare it with: a tampered cursor must answer 400, never
 * reach PostgreSQL as a malformed uuid, date or timestamp (500).
 */
export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** How a cursor value is compared: `i` (the row id) is always a uuid. */
export type CursorValueFormat = "uuid" | "date" | "timestamp" | "text";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VALUE_LENGTH = 500;
/** The years PostgreSQL and the application accept for business data (lib/validation/common.ts). */
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

function validValue(value: string, format: CursorValueFormat): boolean {
  if (value.length > MAX_VALUE_LENGTH) return false;
  switch (format) {
    case "uuid":
      return UUID.test(value);
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!m) return false;
      const year = Number(m[1]);
      const date = new Date(`${value}T00:00:00Z`);
      return (
        year >= MIN_YEAR &&
        year <= MAX_YEAR &&
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    }
    case "timestamp": {
      const date = new Date(value);
      const year = date.getUTCFullYear();
      return !Number.isNaN(date.getTime()) && year >= MIN_YEAR && year <= MAX_YEAR;
    }
    case "text":
      return true;
  }
}

export function decodeCursor<K extends string>(
  cursor: string,
  keys: readonly K[],
  formats: Partial<Record<K, CursorValueFormat>> = {},
): Record<K, string> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const result = {} as Record<K, string>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value !== "string") return null;
      const format = formats[key] ?? (key === "i" ? "uuid" : "text");
      if (!validValue(value, format)) return null;
      result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}
