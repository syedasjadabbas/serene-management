import { defineSessionRoute } from "@/lib/http/route";
import { reasonOnlySchema, userParamsSchema } from "@/modules/users/users.schema";
import { issuePasswordReset } from "@/modules/users/users.service";

/**
 * Issues a one-time password reset link (H4). The link is in this response only;
 * responses are never cached (no-store) and the token is never logged.
 */
export const POST = defineSessionRoute({
  permission: "users:manage",
  params: userParamsSchema,
  body: reasonOnlySchema,
  status: 201,
  rateLimit: { name: "auth.password.reset.issue", limit: 10, windowMs: 60 * 60_000 },
  handler: ({ ctx, params, body }) => issuePasswordReset(ctx, params.userId, body),
});
