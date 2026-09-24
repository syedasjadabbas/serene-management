import { definePropertyRoute } from "@/lib/http/route";
import { closeTaskSchema, taskParamsSchema } from "@/modules/housekeeping/housekeeping.schema";
import { closeTask } from "@/modules/housekeeping/housekeeping.service";

export const POST = definePropertyRoute({
  permission: "housekeeping:assign",
  params: taskParamsSchema,
  body: closeTaskSchema,
  handler: ({ ctx, params, body }) => closeTask(ctx, params.taskId, "cancel", body),
});
