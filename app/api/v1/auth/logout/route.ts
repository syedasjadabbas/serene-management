import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies } from "@/lib/auth/cookies";
import { definePublicRoute } from "@/lib/http/route";
import { logout } from "@/modules/identity/identity.service";

/** Idempotent; works even when the access token has already expired. */
export const POST = definePublicRoute({
  handler: async ({ request, meta }) => {
    await logout(meta, {
      refreshToken: request.cookies.get(REFRESH_COOKIE)?.value,
      accessToken: request.cookies.get(ACCESS_COOKIE)?.value,
    });
    const response = NextResponse.json({ data: { loggedOut: true } });
    clearAuthCookies(response);
    return response;
  },
});
