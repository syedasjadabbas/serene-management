/**
 * Locale configuration (docs/ARCHITECTURE.md §Localization).
 * Messages live in lib/i18n/messages/<locale>.json and are resolved by key;
 * business logic returns codes (ErrorCode, enum values), never display text.
 */
export const LOCALES = ["en", "ur", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const RTL_LOCALES: ReadonlySet<Locale> = new Set(["ur", "ar"]);

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): "ltr" | "rtl" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}
