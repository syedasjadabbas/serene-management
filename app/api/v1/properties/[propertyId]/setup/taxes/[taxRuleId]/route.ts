import { definePropertyRoute } from "@/lib/http/route";
import { taxParamsSchema, updateTaxSchema } from "@/modules/setup/setup.schema";
import { updateTax } from "@/modules/setup/setup.service";

/** Edits (or retires) one entry of the property setup (settings:manage, HIGH audit). */
export const PATCH = definePropertyRoute({
  permission: "settings:manage",
  params: taxParamsSchema,
  body: updateTaxSchema,
  handler: ({ ctx, params, body }) => updateTax(ctx, params.taxRuleId, body),
});
