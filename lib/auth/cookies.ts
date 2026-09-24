import type { NextResponse } from "next/server";

/**
 * Auth cookie names and attributes (docs/ARCHITECTURE.md §9).
 * No `server-only` guard: proxy.ts and route handlers both use it, and it
 * contains no secrets.
 */
export const ACCESS_COOKIE = "sm_at";
export const REFRESH_COOKIE = "sm_rt";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
/**
 * Secret-free marker ("1") with the refresh token's lifetime, visible on page
 * paths. The refresh cookie itself is scoped to /api/v1/auth, so proxy.ts uses
 * this marker to choose between a silent refresh and the login page.
 */
export const SESSION_MARKER_COOKIE = "sm_s";

const secure = process.env.NODE_ENV === "production";

export function setAuthCookies(
  response: NextResponse,
  tokens: {
    accessToken: string;
    accessTtlSeconds: number;
    refreshToken?: string;
    refreshExpiresAt?: Date;
  },
): void {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.accessTtlSeconds,
  });
  if (tokens.refreshToken && tokens.refreshExpiresAt) {
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
    response.cookies.set(SESSION_MARKER_COOKIE, "1", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: tokens.refreshExpiresAt,
    });
  }
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
  response.cookies.set(SESSION_MARKER_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
