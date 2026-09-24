import { definePropertyRoute } from "@/lib/http/route";
import { cancelRequestSchema, requestParamsSchema } from "@/modules/maintenance/maintenance.schema";
import { manageRequest } from "@/modules/maintenance/maintenance.service";

export const POST = definePropertyRoute({
  permission: "maintenance:manage",
  params: requestParamsSchema,
  body: cancelRequestSchema,
  handler: ({ ctx, params, body }) => manageRequest(ctx, params.requestId, "cancel", body),
});
