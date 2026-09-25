import { defineSessionRoute } from "@/lib/http/route";
import { createGuestNoteSchema, guestParamsSchema } from "@/modules/guests/guests.schema";
import { addGuestNote } from "@/modules/guests/guests.service";

export const POST = defineSessionRoute({
  params: guestParamsSchema,
  body: createGuestNoteSchema,
  status: 201,
  handler: ({ ctx, params, body }) => addGuestNote(ctx, params.guestId, body),
});
