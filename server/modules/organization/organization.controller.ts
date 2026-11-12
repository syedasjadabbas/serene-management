import { handle } from "@/lib/controller";
import { sendWebResponse } from "@/lib/web-response";
import {
  centralAvailability,
  exportOrganizationPerformance,
  getOrganizationOverview,
  organizationPerformance,
} from "./organization.service";

export const overview = handle((req) => getOrganizationOverview(req.ctx));
export const performance = handle((req, res) => organizationPerformance(req.ctx, res.locals.query));
export const availability = handle((req, res) => centralAvailability(req.ctx, res.locals.query));

/** CSV download: the service's Response is written to `res` as is. */
export const exportPerformance = handle(async (req, res) => {
  await sendWebResponse(res, await exportOrganizationPerformance(req.ctx, res.locals.query));
});
