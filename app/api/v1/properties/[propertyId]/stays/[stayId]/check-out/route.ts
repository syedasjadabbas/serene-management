import { definePropertyRoute } from "@/lib/http/route";
import { checkOutSchema, stayParamsSchema } from "@/modules/front-desk/front-desk.schema";
import { checkOut } from "@/modules/front-desk/front-desk.service";

/** Operational check-out (settlement arrives with Phase 5). */
export const POST = definePropertyRoute({
  permission: "frontdesk:checkout",
  params: stayParamsSchema,
  body: checkOutSchema,
  handler: ({ ctx, params, body }) => checkOut(ctx, params.stayId, body),
});
