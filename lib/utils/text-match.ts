/**
 * Every word of `query` appears (case-insensitively) somewhere in the texts:
 * the local filter of pickers and global search (rooms, rate plans). Pure, so
 * the server applies exactly the rule the palette applied before.
 */
export function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
