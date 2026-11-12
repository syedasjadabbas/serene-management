import type { RequestHandler } from "express";
import type { z } from "zod";
import { appError } from "@/lib/customError";

/**
 * Request validation middlewares (zod). Schemas are the strict schemas from
 * @serene/shared; a failure is a ZodError that the error handler turns into
 * VALIDATION_FAILED with `details.fields` (lib/response.ts normalizeError).
 *
 * Where the parsed value goes (Express 5):
 *  - body   -> `req.body` (a plain property; the JSON text was already parsed
 *              and size-limited by express.json in app.ts, 1 MiB, JSON only).
 *  - params -> `req.params` (assignable; the router keeps it for the rest of
 *              the route's handlers).
 *  - query  -> `res.locals.query`. In Express 5 `req.query` is a getter that
 *              re-parses the URL on every access, so assigning to it is not
 *              possible (and mutating it is lost). Controllers read
 *              `res.locals.query`; `req.query` stays the raw, unvalidated one.
 *
 * `res.locals.query` is typed `any` (types/express.d.ts) so it can be passed
 * straight to a service function that declares the precise input type.
 */

export function validateBody<T>(schema: z.ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    // express.json only fills req.body for application/json; anything else is refused.
    if (!req.is("application/json")) {
      return next(appError("VALIDATION_FAILED", "Expected a JSON request body"));
    }
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: z.ZodType<T>): RequestHandler {
  return (req, res, next) => {
    // Same parsing as the Next.js routes: flat string map, the last of repeated keys wins.
    const at = req.originalUrl.indexOf("?");
    const raw = Object.fromEntries(
      new URLSearchParams(at < 0 ? "" : req.originalUrl.slice(at + 1)),
    );
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return next(parsed.error);
    res.locals.query = parsed.data;
    next();
  };
}

export function validateParams<T>(schema: z.ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return next(parsed.error);
    req.params = parsed.data as typeof req.params;
    next();
  };
}
