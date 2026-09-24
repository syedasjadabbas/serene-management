import { definePropertyRoute } from "@/lib/http/route";
import {
  requestParamsSchema,
  resolveRequestSchema,
} from "@/modules/maintenance/maintenance.schema";
import { resolveRequest } from "@/modules/maintenance/maintenance.service";

/** Resolve; optionally return the blocked room to service (it comes back dirty for cleaning). */
export const POST = definePropertyRoute({
  permission: "maintenance:update",
  params: requestParamsSchema,
  body: resolveRequestSchema,
  handler: ({ ctx, params, body }) => resolveRequest(ctx, params.requestId, body),
});
