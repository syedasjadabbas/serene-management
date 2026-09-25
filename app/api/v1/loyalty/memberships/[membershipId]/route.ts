import { defineSessionRoute } from "@/lib/http/route";
import { changeMembershipSchema, membershipParamsSchema } from "@/modules/loyalty/loyalty.schema";
import { changeMembership } from "@/modules/loyalty/loyalty.service";

/** Tier / status change (version-checked, reason required). */
export const PATCH = defineSessionRoute({
  params: membershipParamsSchema,
  body: changeMembershipSchema,
  handler: ({ ctx, params, body }) => changeMembership(ctx, params.membershipId, body),
});
