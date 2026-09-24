import { defineSessionRoute } from "@/lib/http/route";
import { listSessions } from "@/modules/identity/identity.service";

export const GET = defineSessionRoute({
  handler: ({ ctx }) => listSessions(ctx),
});
