import { isIP } from "node:net";

/**
 * Client IP resolution behind a known number of trusted reverse proxies
 * (docs/ARCHITECTURE.md §9, D44).
 *
 * Every trusted proxy APPENDS the address it received the connection from to
 * `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For
 * $proxy_add_x_forwarded_for;`). The right-most entries were therefore written
 * by our own proxies and the entry `trustedHops` positions from the right is
 * the address that connected to the outermost trusted proxy — the client.
 * Everything to the left of it was supplied by the client and is ignored.
 *
 * - `trustedHops = 0` (default: no reverse proxy is assumed): forwarded
 *   headers are never trusted and the client IP is unknown (null). Next.js
 *   route handlers do not expose the socket address, so IP-keyed limits are
 *   then skipped instead of sharing one global bucket.
 * - A chain shorter than `trustedHops`, or an entry that is not a valid IP
 *   address, yields null: the request did not come through the expected proxy
 *   path and nothing in the header can be trusted.
 * - `X-Real-IP` and `Forwarded` are never trusted.
 */
export function resolveClientIp(headers: Headers, trustedHops: number): string | null {
  if (!Number.isInteger(trustedHops) || trustedHops <= 0) return null;
  const header = headers.get("x-forwarded-for");
  if (!header) return null;
  const chain = header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (chain.length < trustedHops) return null;
  return normalizeAddress(chain[chain.length - trustedHops]!);
}

/** Accepts `1.2.3.4`, `1.2.3.4:5678`, `::1`, `[::1]:5678`; anything else is null. */
function normalizeAddress(value: string): string | null {
  let address = value;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) address = bracketed[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(address)) address = address.replace(/:\d+$/, "");
  if (isIP(address) === 0) return null;
  return address.toLowerCase().slice(0, 45);
}
