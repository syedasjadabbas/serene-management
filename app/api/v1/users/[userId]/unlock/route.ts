import { defineSessionRoute } from "@/lib/http/route";
import { reasonOnlySchema, userParamsSchema } from "@/modules/users/users.schema";
import { unlockUser } from "@/modules/users/users.service";

export const POST = defineSessionRoute({
  permission: "users:manage",
  params: userParamsSchema,
  body: reasonOnlySchema,
  handler: ({ ctx, params, body }) => unlockUser(ctx, params.userId, body),
});
