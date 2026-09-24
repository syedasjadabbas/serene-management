import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { createTaskSchema, tasksQuerySchema } from "@/modules/housekeeping/housekeeping.schema";
import { createTask, listTasks } from "@/modules/housekeeping/housekeeping.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "housekeeping:read",
  params: propertyParamsSchema,
  query: tasksQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listTasks(ctx, query);
    return withMeta(items, meta);
  },
});

export const POST = definePropertyRoute({
  permission: "housekeeping:assign",
  params: propertyParamsSchema,
  body: createTaskSchema,
  status: 201,
  handler: ({ ctx, body }) => createTask(ctx, body),
});
