import { handleProperty, withMeta } from "@/lib/controller";
import * as service from "./groups.service";

export const list = handleProperty(async (req, res) => {
  const { items, nextCursor } = await service.listGroups(req.ctx, res.locals.query);
  return withMeta(items, { nextCursor, limit: res.locals.query.limit });
});

export const create = handleProperty((req) => service.createGroup(req.ctx, req.body), {
  status: 201,
});

export const options = handleProperty((req) => service.groupOptions(req.ctx));

export const get = handleProperty((req) => service.getGroup(req.ctx, req.params.groupId));

export const update = handleProperty((req) =>
  service.updateGroup(req.ctx, req.params.groupId, req.body),
);

/** New block with its allocation grid; a definite block must fit house availability. */
export const createBlock = handleProperty(
  (req) => service.createBlock(req.ctx, req.params.groupId, req.body),
  { status: 201 },
);

/** Closes or cancels a group (cancelling needs zero pickup; blocks return their rooms). */
export const changeGroupStatus = handleProperty((req) =>
  service.changeGroupStatus(req.ctx, req.params.groupId, req.body),
);

export const setAllocation = handleProperty((req) =>
  service.setAllocation(req.ctx, req.params.blockId, req.body),
);

/** Books rooms from a definite block at the block rate. Idempotency-Key required. */
export const pickup = handleProperty(
  (req) => service.pickup(req.ctx, req.params.blockId, req.body, req.idempotency),
  { status: 201 },
);

/** Returns unpicked rooms to house inventory (irreversible). Idempotency-Key required. */
export const releaseBlock = handleProperty(
  (req) => service.releaseBlock(req.ctx, req.params.blockId, req.body, req.idempotency),
  { status: 201 },
);

export const changeBlockStatus = handleProperty((req) =>
  service.changeBlockStatus(req.ctx, req.params.blockId, req.body),
);
