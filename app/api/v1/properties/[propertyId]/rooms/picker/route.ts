import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { listRoomPicker } from "@/modules/rooms/rooms.service";

/** Active rooms (number and type) for pickers such as the maintenance report dialog. */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => listRoomPicker(ctx),
});
