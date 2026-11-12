/**
 * Which browser origins may talk to the API (CORS) and use the cookie
 * endpoints (CSRF Origin check, plan §4).
 *
 * Production: exactly CLIENT_ORIGINS. Development and tests also accept
 * origins whose hostname is on the development allowlist
 * (isTrustedDevHostname), on any port, so the web app can be opened from
 * another machine of the LAN. Only literal addresses and loopback names: a
 * DNS-rebinding page is served under the attacker's own hostname, which never
 * matches. Never used in production.
 */

/**
 * Hostnames whose own origin development and tests accept, on any port:
 * loopback (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`) and private
 * LAN IPv4 literals `192.168.x.y` (the PC's DHCP address changes).
 */
export function isTrustedDevHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host === "::1") return true;
  const lan = /^192\.168\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return lan !== null && Number(lan[1]) <= 255 && Number(lan[2]) <= 255;
}

export function isAllowedOrigin(
  origin: string | undefined,
  env: { CLIENT_ORIGINS: string[]; NODE_ENV: string },
): boolean {
  if (!origin) return false;
  if (env.CLIENT_ORIGINS.includes(origin)) return true;
  if (env.NODE_ENV === "production") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.origin === origin &&
    isTrustedDevHostname(url.hostname)
  );
}
