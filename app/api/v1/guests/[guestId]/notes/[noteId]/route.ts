import { defineSessionRoute } from "@/lib/http/route";
import { guestNoteParamsSchema } from "@/modules/guests/guests.schema";
import { deleteGuestNote } from "@/modules/guests/guests.service";

export const DELETE = defineSessionRoute({
  params: guestNoteParamsSchema,
  handler: ({ ctx, params }) => deleteGuestNote(ctx, params.guestId, params.noteId),
});
