import { definePropertyRoute } from "@/lib/http/route";
import {
  requestCommandSchema,
  requestParamsSchema,
} from "@/modules/maintenance/maintenance.schema";
import { workRequest } from "@/modules/maintenance/maintenance.service";

export const POST = definePropertyRoute({
  permission: "maintenance:update",
  params: requestParamsSchema,
  body: requestCommandSchema,
  handler: ({ ctx, params, body }) => workRequest(ctx, params.requestId, "hold", body),
});
