import { handle, withMeta } from "@/lib/controller";
import * as service from "./loyalty.service";

/** Programs with their tiers and member counts. */
export const overview = handle((req) => service.loyaltyOverview(req.ctx));

export const createProgram = handle((req) => service.createProgram(req.ctx, req.body), {
  status: 201,
});

export const updateProgram = handle((req) =>
  service.updateProgram(req.ctx, req.params.programId, req.body),
);

export const listMembers = handle(async (req, res) => {
  const { items, nextCursor } = await service.listMembers(
    req.ctx,
    req.params.programId,
    res.locals.query,
  );
  return withMeta(items, { nextCursor, limit: res.locals.query.limit });
});

export const createTier = handle(
  (req) => service.createTier(req.ctx, req.params.programId, req.body),
  { status: 201 },
);

export const updateTier = handle((req) => service.updateTier(req.ctx, req.params.tierId, req.body));

/** Tier / status change (version-checked, reason required). */
export const changeMembership = handle((req) =>
  service.changeMembership(req.ctx, req.params.membershipId, req.body),
);

/** Manual points correction; carries the membership version (a retry answers 409). */
export const adjustPoints = handle(
  (req) => service.adjustPoints(req.ctx, req.params.membershipId, req.body),
  { status: 201 },
);

/** Enrolls the guest in a loyalty program. */
export const enrollGuest = handle(
  (req) => service.enrollGuest(req.ctx, req.params.guestId, req.body),
  { status: 201 },
);
