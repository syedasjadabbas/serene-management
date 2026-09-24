import { defineSessionRoute } from "@/lib/http/route";
import { toMeView } from "@/modules/access/access.service";

export const GET = defineSessionRoute({
  handler: async ({ session }) => toMeView(session),
});
