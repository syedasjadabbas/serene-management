import type { RequestHandler } from "express";
import { appError } from "@/lib/customError";
import { MAX_JSON_BODY_BYTES, errorResponse } from "@/lib/response";

/**
 * Refuses an oversized request body (413 in the error envelope) as soon as it
 * is known to be too large, before express.json would read it: by the declared
 * Content-Length, and while a chunked body (no length) streams in. Without
 * this, the body parser reads off the whole remaining body before answering,
 * so one anonymous request could keep the connection busy indefinitely.
 * The rest of the body is discarded (never buffered) and the connection is
 * closed shortly after the response. express.json (app.ts) enforces
 * the same limit again for everything that passes.
 *
 * The listener is attached in the same tick as express.json's, so no data is lost.
 */
export const bodyLimit: RequestHandler = (req, res, next) => {
  let refused = false;
  const refuse = () => {
    if (refused) return;
    refused = true;
    errorResponse(
      res,
      appError("PAYLOAD_TOO_LARGE", "The request body is too large", {
        limitBytes: MAX_JSON_BODY_BYTES,
      }),
      req.meta.requestId,
    );
    // Let the client finish its write and read the answer, then cut the connection.
    req.resume();
    res.once("finish", () => setTimeout(() => req.destroy(), 2_000).unref());
  };

  const declared = Number(req.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) {
    refuse();
    return;
  }
  let received = 0;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_JSON_BODY_BYTES) refuse();
  });
  next();
};
