import { definePropertyRoute } from "@/lib/http/route";
import { createRoomTypeSchema, setupParamsSchema } from "@/modules/setup/setup.schema";
import { createRoomType } from "@/modules/setup/setup.service";

/** Adds to the property setup (settings:manage, HIGH audit with the reason). */
export const POST = definePropertyRoute({
  permission: "settings:manage",
  params: setupParamsSchema,
  body: createRoomTypeSchema,
  status: 201,
  handler: ({ ctx, body }) => createRoomType(ctx, body),
});
