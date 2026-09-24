import { definePropertyRoute } from "@/lib/http/route";
import {
  blockRequestRoomSchema,
  requestParamsSchema,
} from "@/modules/maintenance/maintenance.schema";
import { blockRequestRoom } from "@/modules/maintenance/maintenance.service";

/** Take the request's room out of use while the work is open; high-risk, reason required. */
export const POST = definePropertyRoute({
  permission: "rooms:out_of_order",
  params: requestParamsSchema,
  body: blockRequestRoomSchema,
  handler: ({ ctx, params, body }) => blockRequestRoom(ctx, params.requestId, body),
});
