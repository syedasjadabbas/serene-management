import type { IdempotencyRequest, RequestMeta, SessionContext } from "@/lib/context";
import type { AuthedSession } from "@/modules/access/access.service";

declare global {
  namespace Express {
    interface Request {
      /** Transport facts, set by the requestId middleware on every request. */
      meta: RequestMeta;
      /**
       * Set by `requireAuth` (SessionContext) and replaced by `propertyScope`
       * with the property-scoped PropertyContext. Only valid behind those
       * middlewares; use `handleProperty` for the PropertyContext typing.
       */
      ctx: SessionContext;
      /** The resolved identity behind `ctx` (for GET /me). Set by `requireAuth`. */
      auth: AuthedSession;
      /** Set by `idempotency(...)`; null when the route allows but the client sent no key. */
      idempotency: IdempotencyRequest | null;
    }
    interface Locals {
      requestId: string;
      /** The validated query (validateQuery). Express 5 `req.query` is read-only. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: any;
    }
  }
}

export {};
