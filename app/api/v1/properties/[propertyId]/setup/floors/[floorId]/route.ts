import { definePropertyRoute } from "@/lib/http/route";
import { floorParamsSchema, updateFloorSchema } from "@/modules/setup/setup.schema";
import { updateFloor } from "@/modules/setup/setup.service";

/** Edits (or retires) one entry of the property setup (settings:manage, HIGH audit). */
export const PATCH = definePropertyRoute({
  permission: "settings:manage",
  params: floorParamsSchema,
  body: updateFloorSchema,
  handler: ({ ctx, params, body }) => updateFloor(ctx, params.floorId, body),
});
