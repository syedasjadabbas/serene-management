import { definePropertyRoute } from "@/lib/http/route";
import { assignTaskSchema, taskParamsSchema } from "@/modules/housekeeping/housekeeping.schema";
import { assignTask } from "@/modules/housekeeping/housekeeping.service";

export const POST = definePropertyRoute({
  permission: "housekeeping:assign",
  params: taskParamsSchema,
  body: assignTaskSchema,
  handler: ({ ctx, params, body }) => assignTask(ctx, params.taskId, body),
});
