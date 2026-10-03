import { definePropertyRoute } from "@/lib/http/route";
import { walkInSchema } from "@/modules/front-desk/front-desk.schema";
import { walkIn } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Walk-in: book (regular reservation engine) and check in, in one transaction. */
export const POST = definePropertyRoute({
  permission: "frontdesk:checkin",
  params: propertyParamsSchema,
  body: walkInSchema,
  /** An Idempotency-Key, when sent, makes a retried walk-in return the first stay. */
  idempotent: "optional",
  status: 201,
  handler: ({ ctx, body, idempotency }) => walkIn(ctx, body, idempotency),
});
