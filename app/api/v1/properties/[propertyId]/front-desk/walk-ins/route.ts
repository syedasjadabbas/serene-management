import { definePropertyRoute } from "@/lib/http/route";
import { walkInSchema } from "@/modules/front-desk/front-desk.schema";
import { walkIn } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Walk-in: book (regular reservation engine) and check in, in one transaction. */
export const POST = definePropertyRoute({
  permission: "frontdesk:checkin",
  params: propertyParamsSchema,
  body: walkInSchema,
  status: 201,
  handler: ({ ctx, body }) => walkIn(ctx, body),
});
