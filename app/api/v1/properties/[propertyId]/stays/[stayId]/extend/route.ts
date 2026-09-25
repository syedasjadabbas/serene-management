import { definePropertyRoute } from "@/lib/http/route";
import { extendStaySchema, stayParamsSchema } from "@/modules/front-desk/front-desk.schema";
import { extendStay } from "@/modules/front-desk/front-desk.service";

/** In-house extension to a later departure (added nights priced and sold). */
export const POST = definePropertyRoute({
  permission: "reservations:update",
  params: stayParamsSchema,
  body: extendStaySchema,
  handler: ({ ctx, params, body }) => extendStay(ctx, params.stayId, body),
});
