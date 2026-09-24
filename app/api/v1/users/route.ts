import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { listUsersQuerySchema } from "@/modules/users/users.schema";
import { listUsers } from "@/modules/users/users.service";

export const GET = defineSessionRoute({
  query: listUsersQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listUsers(ctx, query);
    return withMeta(items, meta);
  },
});
