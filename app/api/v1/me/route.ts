import { defineSessionRoute } from "@/lib/http/route";
import { toMeView } from "@/modules/access/access.service";
import { updateProfileSchema } from "@/modules/identity/identity.schema";
import { updateOwnProfile } from "@/modules/identity/identity.service";

export const GET = defineSessionRoute({
  handler: async ({ session }) => toMeView(session),
});

/** The signed-in user edits their own profile (display name); audited. */
export const PATCH = defineSessionRoute({
  body: updateProfileSchema,
  handler: async ({ ctx, body }) => updateOwnProfile(ctx, body),
});
