import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { roomBoardQuerySchema } from "@/modules/rooms/rooms.schema";
import { listRoomBoard } from "@/modules/rooms/rooms.service";

/** The shared room board (front desk and housekeeping) with counts for the business date. */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: propertyParamsSchema,
  query: roomBoardQuerySchema,
  handler: ({ ctx, query }) => listRoomBoard(ctx, query),
});
