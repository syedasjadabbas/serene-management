import type { ErrorRequestHandler, RequestHandler } from "express";
import { appError } from "@/lib/customError";
import { errorResponse } from "@/lib/response";

/** After every router: unknown routes answer in the error envelope. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(appError("NOT_FOUND", "Route not found", { method: req.method }));
};

/**
 * Every error ends here: normalizeError then errorResponse. Non-operational
 * errors are logged (lib/log.ts, redacted) and answered as INTERNAL_ERROR.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    // A stream already started: nothing sensible to send; end the connection.
    res.end();
    return;
  }
  errorResponse(res, err, req.meta?.requestId);
};
