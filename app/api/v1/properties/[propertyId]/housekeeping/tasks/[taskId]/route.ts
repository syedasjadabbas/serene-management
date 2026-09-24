import { definePropertyRoute } from "@/lib/http/route";
import { taskParamsSchema } from "@/modules/housekeeping/housekeeping.schema";
import { getTask } from "@/modules/housekeeping/housekeeping.service";

export const GET = definePropertyRoute({
  permission: "housekeeping:read",
  params: taskParamsSchema,
  handler: ({ ctx, params }) => getTask(ctx, params.taskId),
});
