/**
 * Opaque keyset-pagination cursor: base64url(JSON) of the last row's sort key
 * and id. Decoding never throws; an invalid cursor yields null (→ 400 upstream).
 */
export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<K extends string>(
  cursor: string,
  keys: readonly K[],
): Record<K, string> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const result = {} as Record<K, string>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value !== "string") return null;
      result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}
