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

/**
 * A word without its vowels (and y), lower case: the spelling-tolerant key
 * for names transliterated several ways, "Ahmad"/"Ahmed" → "hmd",
 * "Mohammad"/"Muhammad" → "mhmmd". Null when it would be too short to mean
 * anything (fewer than 3 consonants), so "Ali" is never matched loosely.
 */
export function consonantSkeleton(word: string): string | null {
  const skeleton = word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/[aeiouy]/g, "");
  return skeleton.length >= 3 ? skeleton : null;
}
