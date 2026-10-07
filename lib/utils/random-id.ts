/**
 * Random RFC 4122 version-4 UUID for client-generated identifiers such as
 * Idempotency-Keys.
 *
 * Browsers expose `crypto.randomUUID()` only in secure contexts (HTTPS and
 * localhost); on a plain-HTTP origin, such as the dev server opened by its LAN
 * address, it is undefined and calling it crashed the booking review, the
 * folio dialogs and the night-audit start. `crypto.getRandomValues()` is
 * available in every context and is the same CSPRNG, so the fallback builds
 * the UUID from it.
 */
export function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
