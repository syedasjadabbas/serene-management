import { NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { definePublicRoute } from "@/lib/http/route";
import { loginSchema } from "@/modules/identity/identity.schema";
import { login } from "@/modules/identity/identity.service";

export const POST = definePublicRoute({
  body: loginSchema,
  // Per-IP brute-force brake; per-account lockout is enforced by the service.
  rateLimit: { name: "auth.login.ip", limit: 20, windowMs: 60_000 },
  handler: async ({ body, meta }) => {
    const { result, tokens } = await login(meta, body);
    const response = NextResponse.json({ data: result });
    setAuthCookies(response, tokens);
    return response;
  },
});
