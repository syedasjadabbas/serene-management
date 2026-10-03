import { definePropertyRoute } from "@/lib/http/route";
import { createRoomsSchema, setupParamsSchema } from "@/modules/setup/setup.schema";
import { createRooms } from "@/modules/setup/setup.service";

/** Adds to the property setup (settings:manage, HIGH audit with the reason). */
export const POST = definePropertyRoute({
  permission: "settings:manage",
  params: setupParamsSchema,
  body: createRoomsSchema,
  status: 201,
  handler: ({ ctx, body }) => createRooms(ctx, body),
});
