import { definePropertyRoute } from "@/lib/http/route";
import { requestParamsSchema } from "@/modules/maintenance/maintenance.schema";
import { getRequest } from "@/modules/maintenance/maintenance.service";

export const GET = definePropertyRoute({
  permission: "maintenance:read",
  params: requestParamsSchema,
  handler: ({ ctx, params }) => getRequest(ctx, params.requestId),
});
