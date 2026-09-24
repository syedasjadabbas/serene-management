import { definePropertyRoute } from "@/lib/http/route";
import { noteSchema, requestParamsSchema } from "@/modules/maintenance/maintenance.schema";
import { addNote } from "@/modules/maintenance/maintenance.service";

export const POST = definePropertyRoute({
  permission: "maintenance:read",
  params: requestParamsSchema,
  body: noteSchema,
  status: 201,
  handler: ({ ctx, params, body }) => addNote(ctx, params.requestId, body),
});
