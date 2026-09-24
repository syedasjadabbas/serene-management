import { definePublicRoute } from "@/lib/http/route";
import { checkDatabase } from "@/modules/access/access.service";

/** Liveness + database connectivity. Reveals nothing beyond "ok". */
export const GET = definePublicRoute({
  handler: async () => {
    await checkDatabase();
    return { status: "ok" };
  },
});
