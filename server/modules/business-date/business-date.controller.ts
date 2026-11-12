import { handleProperty } from "@/lib/controller";
import { getBusinessDateView, initializeBusinessDate } from "./business-date.service";

/** Every user with access to the property may read its business date. */
export const get = handleProperty((req) =>
  getBusinessDateView({ propertyId: req.ctx.propertyId, timezone: req.ctx.timezone }),
);

/** Go-live: opens the first business date of the property (once). */
export const initialize = handleProperty((req) => initializeBusinessDate(req.ctx, req.body), {
  status: 201,
});
