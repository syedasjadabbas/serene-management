import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { serverEnv } from "@/config/env";
import { resolveClientIp } from "@/lib/client-ip";

/**
 * First middleware: the request id (the load balancer's X-Request-Id, else a
 * W3C traceparent's trace id, else a new uuid), the transport facts and the
 * headers every response carries. The same id appears in logs, audit rows
 * and jobs.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const trace = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(
    req.get("traceparent") ?? "",
  )?.[1];
  const id =
    incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
      ? incoming
      : trace && !/^0+$/.test(trace)
        ? trace
        : randomUUID();

  // Only the hops written by our own reverse proxies are trusted (D44); the
  // same address is used for rate limits, sessions and audit rows.
  const forwarded = req.get("x-forwarded-for");
  const headers = new Headers(forwarded ? { "x-forwarded-for": forwarded } : {});
  req.meta = {
    requestId: id,
    ipAddress: resolveClientIp(headers, serverEnv().TRUSTED_PROXY_HOPS),
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
  };
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  // Event streams override this with "no-store, no-transform".
  res.setHeader("cache-control", "no-store");
  next();
};
