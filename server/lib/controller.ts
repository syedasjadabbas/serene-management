/* eslint-disable @typescript-eslint/no-explicit-any -- controller request typing: params/body/query are validated by middlewares and passed to typed services */
import type { Request, RequestHandler, Response } from "express";
import type { PropertyContext } from "@/lib/context";
import { successResponse } from "@/lib/response";

/** Marks a result that carries pagination metadata (`meta` in the envelope). */
export class WithMeta<T, M> {
  constructor(
    readonly data: T,
    readonly meta: M,
  ) {}
}

export function withMeta<T, M>(data: T, meta: M) {
  return new WithMeta(data, meta);
}

/**
 * The request as a controller sees it. `req.params`, `req.body` and
 * `res.locals.query` were validated by the route's middlewares, so they are
 * loosely typed here and flow into the typed service signature.
 */
export type ControllerRequest<C = Request["ctx"]> = Omit<
  Request<Record<string, any>, unknown, any, any>,
  "ctx"
> & { ctx: C };

export type HandleOptions = {
  /** Status of a successful result (default 200). */
  status?: number;
  /** Envelope `message` (default "OK"). */
  message?: string;
};

type Handler<C> = (req: ControllerRequest<C>, res: Response) => unknown;

/**
 * Turns a controller function into an Express handler: awaits the service
 * result and sends the success envelope; a `withMeta(data, meta)` result
 * sends `meta` too; a thrown error goes to the error handler. A function that
 * wrote the response itself (stream, file, 204) returns undefined after
 * sending and is left alone.
 *
 *   export const cancel = handleProperty((req) =>
 *     service.cancelReservation(req.ctx, req.params.reservationRoomId, req.body),
 *   );
 */
export function handle<C = Request["ctx"]>(
  fn: Handler<C>,
  options: HandleOptions = {},
): RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await fn(req as unknown as ControllerRequest<C>, res);
      if (res.headersSent || res.writableEnded) return;
      if (result instanceof WithMeta) {
        successResponse(res, result.data, { ...options, meta: result.meta });
      } else {
        successResponse(res, result, options);
      }
    } catch (error) {
      next(error);
    }
  };
}

/** `handle` for property routes: `req.ctx` is the PropertyContext built by `propertyScope`. */
export function handleProperty(fn: Handler<PropertyContext>, options: HandleOptions = {}) {
  return handle<PropertyContext>(fn, options);
}
