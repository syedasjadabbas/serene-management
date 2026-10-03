import { definePropertyRoute } from "@/lib/http/route";
import { createFloorSchema, setupParamsSchema } from "@/modules/setup/setup.schema";
import { createFloor } from "@/modules/setup/setup.service";

/** Adds to the property setup (settings:manage, HIGH audit with the reason). */
export const POST = definePropertyRoute({
  permission: "settings:manage",
  params: setupParamsSchema,
  body: createFloorSchema,
  status: 201,
  handler: ({ ctx, body }) => createFloor(ctx, body),
});
