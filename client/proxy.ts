import { type NextRequest, NextResponse } from "next/server";
import { API_ORIGIN } from "@/global/constants/api";

/**
 * Per-request CSP nonce and security headers (docs/ARCHITECTURE.md §9).
 *
 * No auth gating here: the access token lives in client memory, not in a
 * cookie the Next.js server can see (docs/SERVER_SPLIT_PLAN.md §4/§5). Routes
 * are guarded on the client (app/(workspace)/_components/WorkspaceAuthGuard).
 * `connect-src` allows the API server's origin (NEXT_PUBLIC_API_URL).
 */
export async function proxy(request: NextRequest) {
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
  const connect = ["'self'", API_ORIGIN].join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes/tags are used by the framework in development and by
    // font loading; styles cannot execute code, so this is an accepted trade-off.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect}`,
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
      // The service worker, manifest and icon are public static files: they
      // must load without a session (sign-in page, offline shell).
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
