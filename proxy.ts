import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, SESSION_MARKER_COOKIE } from "@/lib/auth/cookies";
import { verifyAccessToken } from "@/lib/auth/tokens";

/**
 * Lightweight route gating + per-request CSP nonce (docs/ARCHITECTURE.md §9).
 *
 * Only checks that the access token is genuine and unexpired (no database
 * access). It is NOT an authorization layer: layouts re-check the session and
 * property access server-side, and every API route authenticates and
 * authorizes on its own. API routes are excluded by the matcher.
 */

const PUBLIC_PATHS = new Set(["/login", "/refresh"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);
  const hasValidAccessToken =
    (await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value)) !== null;

  if (!isPublic && !hasValidAccessToken) {
    // A live session marker means the refresh cookie probably exists: try a
    // silent refresh before asking the user to sign in again.
    const target = request.cookies.has(SESSION_MARKER_COOKIE) ? "/refresh" : "/login";
    const url = new URL(target, request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes/tags are used by the framework in development and by
    // font loading; styles cannot execute code, so this is an accepted trade-off.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
