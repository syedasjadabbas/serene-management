import { defineSessionRoute } from "@/lib/http/route";
import { listRoles } from "@/modules/users/users.service";

export const GET = defineSessionRoute({
  handler: ({ ctx }) => listRoles(ctx),
});
