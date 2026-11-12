import type { Request } from "express";
import { handleProperty } from "@/lib/controller";
import { openPropertyEvents } from "./realtime.service";

/**
 * Live updates of one property (server-sent events, docs/SCALABILITY.md section 31).
 * The service writes the stream to `res` itself.
 */
export const events = handleProperty((req, res) => {
  openPropertyEvents(req.ctx, req as unknown as Request, res);
});
