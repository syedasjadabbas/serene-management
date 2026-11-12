import { handleProperty } from "@/lib/controller";
import { hasPermission } from "@serene/shared/lib/permissions/evaluate";
import { inspectRoom, setRoomHousekeeping } from "@/modules/housekeeping/housekeeping.service";
import { placeRoomBlock, returnRoomToService, serviceReasonCodes } from "./room-operations.service";
import { boardReferenceData, getRoom, listRoomBoard, listRoomPicker } from "./rooms.service";

/** The shared room board (front desk and housekeeping) with counts for the business date. */
export const board = handleProperty((req, res) => listRoomBoard(req.ctx, res.locals.query));

/** Floors and room types for the board filters; block reasons for users who may block rooms. */
export const boardOptions = handleProperty(async (req) => ({
  ...(await boardReferenceData(req.ctx)),
  blockReasons: hasPermission(req.ctx.access, req.ctx.propertyId, "rooms:out_of_order")
    ? await serviceReasonCodes(req.ctx)
    : [],
}));

/** Active rooms (number and type) for pickers such as the maintenance report dialog. */
export const picker = handleProperty((req) => listRoomPicker(req.ctx));

export const get = handleProperty((req) => getRoom(req.ctx, req.params.roomId));

/** Out of order or out of service; high-risk, reason required. */
export const placeBlock = handleProperty(
  (req) => placeRoomBlock(req.ctx, req.params.roomId, req.body),
  { status: 201 },
);

/** Return to service: the room comes back dirty with a priority cleaning task. */
export const releaseBlock = handleProperty((req) =>
  returnRoomToService(req.ctx, req.params.blockId, req.body),
);

export const inspect = handleProperty((req) => inspectRoom(req.ctx, req.params.roomId, req.body));
export const markClean = handleProperty((req) =>
  setRoomHousekeeping(req.ctx, req.params.roomId, "mark_clean", req.body),
);
export const markDirty = handleProperty((req) =>
  setRoomHousekeeping(req.ctx, req.params.roomId, "mark_dirty", req.body),
);
