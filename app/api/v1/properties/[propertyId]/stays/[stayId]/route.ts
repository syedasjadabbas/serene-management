import { definePropertyRoute } from "@/lib/http/route";
import { stayParamsSchema } from "@/modules/front-desk/front-desk.schema";
import { getStay } from "@/modules/front-desk/front-desk.service";

export const GET = definePropertyRoute({
  permission: "frontdesk:read",
  params: stayParamsSchema,
  handler: ({ ctx, params }) => getStay(ctx, params.stayId),
});
