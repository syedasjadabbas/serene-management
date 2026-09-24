import { definePropertyRoute } from "@/lib/http/route";
import { assignRequestSchema, requestParamsSchema } from "@/modules/maintenance/maintenance.schema";
import { assignRequest } from "@/modules/maintenance/maintenance.service";

export const POST = definePropertyRoute({
  permission: "maintenance:manage",
  params: requestParamsSchema,
  body: assignRequestSchema,
  handler: ({ ctx, params, body }) => assignRequest(ctx, params.requestId, body),
});
