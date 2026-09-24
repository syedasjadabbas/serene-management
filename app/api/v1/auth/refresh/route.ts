import { NextResponse } from "next/server";
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from "@/lib/auth/cookies";
import { AppError } from "@/lib/http/errors";
import { toErrorResponse } from "@/lib/http/response";
import { definePublicRoute } from "@/lib/http/route";
import { refresh } from "@/modules/identity/identity.service";

export const POST = definePublicRoute({
  rateLimit: { name: "auth.refresh.ip", limit: 60, windowMs: 60_000 },
  handler: async ({ request, meta }) => {
    try {
      const tokens = await refresh(meta, request.cookies.get(REFRESH_COOKIE)?.value);
      const response = NextResponse.json({ data: { refreshed: true } });
      setAuthCookies(response, tokens);
      return response;
    } catch (error) {
      // A dead refresh token must not linger in the browser.
      if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
        const response = toErrorResponse(error, meta.requestId);
        clearAuthCookies(response);
        return response;
      }
      throw error;
    }
  },
});
