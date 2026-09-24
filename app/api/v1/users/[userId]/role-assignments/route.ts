import { defineSessionRoute } from "@/lib/http/route";
import { grantRoleSchema, userParamsSchema } from "@/modules/users/users.schema";
import { grantRole } from "@/modules/users/users.service";

/** Authorization depends on the requested scope, so the service checks users:manage there. */
export const POST = defineSessionRoute({
  params: userParamsSchema,
  body: grantRoleSchema,
  status: 201,
  handler: ({ ctx, params, body }) => grantRole(ctx, params.userId, body),
});
