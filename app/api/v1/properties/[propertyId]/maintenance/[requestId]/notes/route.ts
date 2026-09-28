import { definePropertyRoute } from "@/lib/http/route";
import { noteSchema, requestParamsSchema } from "@/modules/maintenance/maintenance.schema";
import { addNote } from "@/modules/maintenance/maintenance.service";

/** Adding a note is work on the request: the same permission as start/hold/resolve (L13). */
export const POST = definePropertyRoute({
  permission: "maintenance:update",
  params: requestParamsSchema,
  body: noteSchema,
  status: 201,
  handler: ({ ctx, params, body }) => addNote(ctx, params.requestId, body),
});
