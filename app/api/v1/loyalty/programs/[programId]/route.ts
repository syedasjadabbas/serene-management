import { defineSessionRoute } from "@/lib/http/route";
import { programParamsSchema, updateProgramSchema } from "@/modules/loyalty/loyalty.schema";
import { updateProgram } from "@/modules/loyalty/loyalty.service";

export const PATCH = defineSessionRoute({
  params: programParamsSchema,
  body: updateProgramSchema,
  handler: ({ ctx, params, body }) => updateProgram(ctx, params.programId, body),
});
