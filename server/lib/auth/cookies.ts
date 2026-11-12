import type { CookieOptions, Response } from "express";

/**
 * The refresh cookie is the only cookie the API sets (plan section 4): the
 * access token travels in the Authorization header, held in client memory.
 * httpOnly, SameSite=Strict, scoped to /api/v1/auth, so the browser sends it
 * only to the refresh and logout endpoints. In production it is Secure and
 * carries the browser-enforced `__Secure-` prefix (L4); development over
 * http://localhost keeps the plain name.
 */
const secure = () => process.env.NODE_ENV === "production";

export const refreshCookieName = () => (secure() ? "__Secure-sm_rt" : "sm_rt");
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

function options(): CookieOptions {
  return { httpOnly: true, secure: secure(), sameSite: "strict", path: REFRESH_COOKIE_PATH };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(refreshCookieName(), token, { ...options(), expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.cookie(refreshCookieName(), "", { ...options(), maxAge: 0, expires: new Date(0) });
}

export function readRefreshCookie(
  cookies: Record<string, unknown> | undefined,
): string | undefined {
  const value = cookies?.[refreshCookieName()];
  return typeof value === "string" && value !== "" ? value : undefined;
}
