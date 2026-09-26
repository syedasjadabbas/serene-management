import { NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { defineSessionRoute } from "@/lib/http/route";
import { changePasswordSchema } from "@/modules/identity/identity.schema";
import { changePassword } from "@/modules/identity/identity.service";

/**
 * The signed-in user changes their password (H4). Every earlier session is
 * revoked and this browser receives a fresh session.
 */
export const POST = defineSessionRoute({
  body: changePasswordSchema,
  handler: async ({ ctx, body }) => {
    const tokens = await changePassword(ctx, body);
    const response = NextResponse.json({ data: { changed: true } });
    setAuthCookies(response, tokens);
    return response;
  },
});
