import { handleProperty } from "@/lib/controller";
import * as packages from "./packages.service";
import * as plans from "./rate-plans.service";

export const listPackages = handleProperty((req) => packages.listPackages(req.ctx));

export const createPackage = handleProperty((req) => packages.createPackage(req.ctx, req.body), {
  status: 201,
});

export const getPackage = handleProperty((req) =>
  packages.getPackage(req.ctx, req.params.packageId),
);

export const updatePackage = handleProperty((req) =>
  packages.updatePackage(req.ctx, req.params.packageId, req.body),
);

export const listRatePlans = handleProperty((req) => plans.listRatePlans(req.ctx));

/** New rate plan in the property currency (high-risk: reason required). */
export const createRatePlan = handleProperty((req) => plans.createRatePlan(req.ctx, req.body), {
  status: 201,
});

export const getRatePlan = handleProperty((req) =>
  plans.getRatePlan(req.ctx, req.params.ratePlanId),
);

/** Versioned update (409 on a stale version); high-risk. */
export const updateRatePlan = handleProperty((req) =>
  plans.updateRatePlan(req.ctx, req.params.ratePlanId, req.body),
);

/** Replaces the companies a negotiated rate plan is sold to. */
export const setRatePlanAccounts = handleProperty((req) =>
  plans.setRatePlanAccounts(req.ctx, req.params.ratePlanId, req.body),
);

/** Replaces the packages included in a rate plan. */
export const setRatePlanPackages = handleProperty((req) =>
  plans.setRatePlanPackages(req.ctx, req.params.ratePlanId, req.body),
);

/** Adds a pricing season to a base plan (ambiguous overlaps are refused). */
export const createSeason = handleProperty(
  (req) => plans.createSeason(req.ctx, req.params.ratePlanId, req.body),
  { status: 201 },
);

export const updateSeasonPrices = handleProperty((req) =>
  plans.updateSeasonPrices(req.ctx, req.params.ratePlanId, req.params.seasonId, req.body),
);

export const removeSeason = handleProperty((req) =>
  plans.removeSeason(req.ctx, req.params.ratePlanId, req.params.seasonId, req.body),
);

/** Day-by-day prices and restrictions of a plan and room type. */
export const rateCalendar = handleProperty((req, res) =>
  plans.rateCalendar(req.ctx, res.locals.query),
);

export const rateAdminOptions = handleProperty((req) => plans.rateAdminOptions(req.ctx));
