import { definePropertyRoute } from "@/lib/http/route";
import { roomBoardQuerySchema } from "@/modules/front-desk/front-desk.schema";
import { listRoomBoard } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Room board: every active room with occupancy, readiness and today's arrival. */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: propertyParamsSchema,
  query: roomBoardQuerySchema,
  handler: ({ ctx, query }) => listRoomBoard(ctx, query),
});
