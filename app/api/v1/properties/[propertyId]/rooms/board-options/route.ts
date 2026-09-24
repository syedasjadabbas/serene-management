import { definePropertyRoute } from "@/lib/http/route";
import { hasPermission } from "@/lib/permissions/evaluate";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { serviceReasonCodes } from "@/modules/rooms/room-operations.service";
import { boardReferenceData } from "@/modules/rooms/rooms.service";

/** Floors and room types for the board filters; block reasons for users who may block rooms. */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: propertyParamsSchema,
  handler: async ({ ctx }) => ({
    ...(await boardReferenceData(ctx)),
    blockReasons: hasPermission(ctx.access, ctx.propertyId, "rooms:out_of_order")
      ? await serviceReasonCodes(ctx)
      : [],
  }),
});
