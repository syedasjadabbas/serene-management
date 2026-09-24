import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { defineSessionRoute } from "@/lib/http/route";
import { sessionParamsSchema } from "@/modules/identity/identity.schema";
import { revokeOwnSession } from "@/modules/identity/identity.service";

export const DELETE = defineSessionRoute({
  params: sessionParamsSchema,
  handler: async ({ ctx, params }) => {
    const result = await revokeOwnSession(ctx, params.sessionId);
    const response = NextResponse.json({ data: result });
    if (result.current) clearAuthCookies(response);
    return response;
  },
});
