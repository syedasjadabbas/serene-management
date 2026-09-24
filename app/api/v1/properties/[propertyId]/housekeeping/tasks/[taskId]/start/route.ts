import { definePropertyRoute } from "@/lib/http/route";
import { taskCommandSchema, taskParamsSchema } from "@/modules/housekeeping/housekeeping.schema";
import { workTask } from "@/modules/housekeeping/housekeeping.service";

export const POST = definePropertyRoute({
  permission: "housekeeping:update",
  params: taskParamsSchema,
  body: taskCommandSchema,
  handler: ({ ctx, params, body }) => workTask(ctx, params.taskId, "start", body),
});
