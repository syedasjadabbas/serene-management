import type { Request } from "express";
import { handle, handleProperty } from "@/lib/controller";
import { addServerTiming, serverTimingEnabled } from "@/middlewares/observe";
import * as service from "./search.service";

/** Opt-in Server-Timing per record type (SERVER_TIMING=1). */
function timing(req: unknown) {
  return serverTimingEnabled()
    ? (type: string, ms: number) => addServerTiming(req as Request, `search-${type}`, ms)
    : undefined;
}

/** Organization workspace: guest and company profiles, each checked by the service. */
export const organization = handle((req, res) =>
  service.searchOrganization(req.ctx, req.auth.properties, res.locals.query.q, {
    onTiming: timing(req),
  }),
);

/** One property: every record type the user may read here (each checked by the service). */
export const property = handleProperty((req, res) =>
  service.searchProperty(req.ctx, res.locals.query.q, { onTiming: timing(req) }),
);
