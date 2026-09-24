import { defineSessionRoute } from "@/lib/http/route";
import { reasonOnlySchema, userParamsSchema } from "@/modules/users/users.schema";
import { disableUser } from "@/modules/users/users.service";

export const POST = defineSessionRoute({
  permission: "users:manage",
  params: userParamsSchema,
  body: reasonOnlySchema,
  handler: ({ ctx, params, body }) => disableUser(ctx, params.userId, body),
});
