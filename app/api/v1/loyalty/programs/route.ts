import { defineSessionRoute } from "@/lib/http/route";
import { createProgramSchema } from "@/modules/loyalty/loyalty.schema";
import { createProgram, loyaltyOverview } from "@/modules/loyalty/loyalty.service";

/** Programs with their tiers and member counts. */
export const GET = defineSessionRoute({
  handler: ({ ctx }) => loyaltyOverview(ctx),
});

export const POST = defineSessionRoute({
  body: createProgramSchema,
  status: 201,
  handler: ({ ctx, body }) => createProgram(ctx, body),
});
