import { defineSessionRoute } from "@/lib/http/route";
import { reasonOnlySchema, roleAssignmentParamsSchema } from "@/modules/users/users.schema";
import { revokeRole } from "@/modules/users/users.service";

export const DELETE = defineSessionRoute({
  params: roleAssignmentParamsSchema,
  body: reasonOnlySchema,
  handler: ({ ctx, params, body }) => revokeRole(ctx, params.userId, params.assignmentId, body),
});
