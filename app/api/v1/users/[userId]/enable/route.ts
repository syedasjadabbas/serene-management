import { defineSessionRoute } from "@/lib/http/route";
import { reasonOnlySchema, userParamsSchema } from "@/modules/users/users.schema";
import { enableUser } from "@/modules/users/users.service";

/** Re-enables a disabled user; the caller must outrank the target (H3). */
export const POST = defineSessionRoute({
  permission: "users:manage",
  params: userParamsSchema,
  body: reasonOnlySchema,
  handler: ({ ctx, params, body }) => enableUser(ctx, params.userId, body),
});
