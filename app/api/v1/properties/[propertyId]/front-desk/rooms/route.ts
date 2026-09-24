import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { roomBoardQuerySchema } from "@/modules/rooms/rooms.schema";
import { listRoomBoard } from "@/modules/rooms/rooms.service";

/** Room board rows for the front desk (the shared board of the rooms module, without counts). */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: propertyParamsSchema,
  query: roomBoardQuerySchema,
  handler: async ({ ctx, query }) => (await listRoomBoard(ctx, query)).items,
});
