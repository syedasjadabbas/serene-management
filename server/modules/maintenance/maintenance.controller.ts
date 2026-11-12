import { handleProperty, withMeta } from "@/lib/controller";
import {
  addNote,
  assignRequest,
  blockRequestRoom,
  createRequest,
  getRequest,
  listRequests,
  maintenanceOptions,
  maintenanceSummary,
  manageRequest,
  resolveRequest,
  workRequest,
} from "./maintenance.service";

export const list = handleProperty(async (req, res) => {
  const { items, meta } = await listRequests(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

/** Report an issue (optionally taking the room out of use: rooms:out_of_order + reason). */
export const create = handleProperty((req) => createRequest(req.ctx, req.body), { status: 201 });

/** Categories, assignees and block reasons for reporting and assigning work. */
export const options = handleProperty((req) => maintenanceOptions(req.ctx));
export const summary = handleProperty((req) => maintenanceSummary(req.ctx));
export const get = handleProperty((req) => getRequest(req.ctx, req.params.requestId));
export const assign = handleProperty((req) =>
  assignRequest(req.ctx, req.params.requestId, req.body),
);

/** Take the request's room out of use while the work is open; high-risk, reason required. */
export const blockRoom = handleProperty((req) =>
  blockRequestRoom(req.ctx, req.params.requestId, req.body),
);

export const cancel = handleProperty((req) =>
  manageRequest(req.ctx, req.params.requestId, "cancel", req.body),
);
export const close = handleProperty((req) =>
  manageRequest(req.ctx, req.params.requestId, "close", req.body),
);
export const reopen = handleProperty((req) =>
  manageRequest(req.ctx, req.params.requestId, "reopen", req.body),
);
export const hold = handleProperty((req) =>
  workRequest(req.ctx, req.params.requestId, "hold", req.body),
);
export const resume = handleProperty((req) =>
  workRequest(req.ctx, req.params.requestId, "resume", req.body),
);
export const start = handleProperty((req) =>
  workRequest(req.ctx, req.params.requestId, "start", req.body),
);

/** Adding a note is work on the request: the same permission as start/hold/resolve (L13). */
export const addNoteHandler = handleProperty(
  (req) => addNote(req.ctx, req.params.requestId, req.body),
  { status: 201 },
);

/** Resolve; optionally return the blocked room to service (it comes back dirty for cleaning). */
export const resolve = handleProperty((req) =>
  resolveRequest(req.ctx, req.params.requestId, req.body),
);
