import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { inviteUserSchema, listUsersQuerySchema } from "@/modules/users/users.schema";
import { inviteUser, listUsers } from "@/modules/users/users.service";

export const GET = defineSessionRoute({
  query: listUsersQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listUsers(ctx, query);
    return withMeta(items, meta);
  },
});

/**
 * Adds a user with a first role (`users:manage` in that scope, checked in the
 * service under the administration lock). Returns the one-time set-password link.
 */
export const POST = defineSessionRoute({
  body: inviteUserSchema,
  status: 201,
  rateLimit: { name: "users.invite", limit: 30, windowMs: 60_000 },
  handler: ({ ctx, body }) => inviteUser(ctx, body),
});
