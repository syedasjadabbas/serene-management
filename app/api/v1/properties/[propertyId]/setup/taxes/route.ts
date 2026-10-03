import { definePropertyRoute } from "@/lib/http/route";
import { createTaxSchema, setupParamsSchema } from "@/modules/setup/setup.schema";
import { createTax } from "@/modules/setup/setup.service";

/** Adds to the property setup (settings:manage, HIGH audit with the reason). */
export const POST = definePropertyRoute({
  permission: "settings:manage",
  params: setupParamsSchema,
  body: createTaxSchema,
  status: 201,
  handler: ({ ctx, body }) => createTax(ctx, body),
});
