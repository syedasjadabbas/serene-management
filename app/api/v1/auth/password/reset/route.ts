import { definePublicRoute } from "@/lib/http/route";
import { completePasswordResetSchema } from "@/modules/identity/identity.schema";
import { completePasswordReset } from "@/modules/identity/identity.service";

/** Sets a new password with a one-time reset token (H4). */
export const POST = definePublicRoute({
  body: completePasswordResetSchema,
  rateLimit: { name: "auth.password.reset.ip", limit: 10, windowMs: 60_000 },
  handler: async ({ body, meta }) => {
    await completePasswordReset(meta, body);
    return { reset: true };
  },
});
