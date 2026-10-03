import { definePropertyRoute } from "@/lib/http/route";
import { checkOutSchema, stayParamsSchema } from "@/modules/front-desk/front-desk.schema";
import { checkOut } from "@/modules/front-desk/front-desk.service";

/** Check-out: settles nothing itself; folio balance rules apply (PMS_WORKFLOWS §6). */
export const POST = definePropertyRoute({
  permission: "frontdesk:checkout",
  params: stayParamsSchema,
  body: checkOutSchema,
  handler: ({ ctx, params, body }) => checkOut(ctx, params.stayId, body),
});
