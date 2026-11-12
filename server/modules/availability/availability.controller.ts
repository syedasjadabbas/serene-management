import { handleProperty } from "@/lib/controller";
import { searchAvailability } from "./availability.service";
import { listRestrictions, setRestrictions } from "./restrictions.service";

/** Room types that can accommodate the request, with counts, status and rate quotes. */
export const search = handleProperty((req, res) => searchAvailability(req.ctx, res.locals.query));

export const listRestrictionsHandler = handleProperty((req, res) =>
  listRestrictions(req.ctx, res.locals.query),
);

/** Sets or clears one restriction over a date range (high-risk: reason required). */
export const setRestrictionsHandler = handleProperty((req) => setRestrictions(req.ctx, req.body));
