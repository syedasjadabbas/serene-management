import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { type PoolUsage, withPoolUsage } from "@/lib/db/pool-metrics";
import { instanceId, trackRequest } from "@/lib/lifecycle/shutdown";
import { recordRequest, routeTemplate } from "@/lib/observability/metrics";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { serverEnv } from "@/lib/env";
import { type Permission, isHighRisk } from "@/lib/permissions/catalog";
import {
  canAccessProperty,
  hasOrganizationPermission,
  hasPermission,
} from "@/lib/permissions/evaluate";
import { type ResolvedSession, resolveSession } from "@/modules/access/access.service";
import type { IdempotencyRequest, PropertyContext, RequestMeta, SessionContext } from "./context";
import { AppError, forbidden } from "./errors";
import { resolveClientIp } from "./client-ip";
import { consumeRateLimit, type RateLimitRule, rateLimitKey } from "./rate-limit";
import { ok, toErrorResponse } from "./response";

/**
 * Route handler pipeline (docs/ARCHITECTURE.md §4, docs/API_CONVENTIONS.md):
 *   request id → CSRF origin check → rate limit → authenticate → scope the
 *   property (URL path only) → authorize → validate → service → envelope.
 * Handlers stay thin: they call one service function and return its result.
 */

type RouteContextArg = { params: Promise<Record<string, string | string[] | undefined>> };
type RouteFn = (request: NextRequest, context: RouteContextArg) => Promise<Response>;

interface Schemas<P, Q, B> {
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
}

interface Parsed<P, Q, B> {
  request: NextRequest;
  params: P;
  query: Q;
  body: B;
}

interface CommonOptions<P, Q, B> extends Schemas<P, Q, B> {
  /**
   * Extra per-route limit. Keyed per user on authenticated routes and per
   * client IP on public ones (G11).
   */
  rateLimit?: RateLimitRule;
  /** HTTP status for a successful non-Response result (default 200). */
  status?: number;
}

/** Marks a result that carries pagination metadata. */
export class WithMeta<T, M> {
  constructor(
    readonly data: T,
    readonly meta: M,
  ) {}
}

export function withMeta<T, M>(data: T, meta: M) {
  return new WithMeta(data, meta);
}

export function definePublicRoute<P = undefined, Q = undefined, B = undefined>(
  options: CommonOptions<P, Q, B> & {
    handler: (args: Parsed<P, Q, B> & { meta: RequestMeta }) => Promise<unknown>;
  },
): RouteFn {
  return (request, context) =>
    run(request, options, async (meta) => {
      if (options.rateLimit) await enforceRateLimit(options.rateLimit, rateLimitKey(meta));
      const parsed = await parse(request, context, options);
      return options.handler({ ...parsed, meta });
    });
}

/**
 * Authenticated, organization-level route. `permission` (optional) is checked
 * against organization-scope grants. Routes whose authorization depends on
 * the payload (e.g. a role grant for a given property) omit it and let the
 * service decide.
 */
export function defineSessionRoute<P = undefined, Q = undefined, B = undefined>(
  options: CommonOptions<P, Q, B> & {
    permission?: Permission;
    /** `session` is the already-resolved identity (user, organization, properties). */
    handler: (
      args: Parsed<P, Q, B> & { ctx: SessionContext; session: ResolvedSession },
    ) => Promise<unknown>;
  },
): RouteFn {
  return (request, context) =>
    run(request, options, async (meta) => {
      const { ctx, session } = await authenticate(request, meta);
      if (options.rateLimit) await enforceRateLimit(options.rateLimit, rateLimitKey(ctx));
      if (options.permission && !hasOrganizationPermission(ctx.access, options.permission)) {
        throw forbidden(options.permission);
      }
      const parsed = await parse(request, context, options);
      assertReasonForHighRisk(request, options.permission, parsed.body);
      return options.handler({ ...parsed, ctx, session });
    });
}

/**
 * Authenticated route under /api/v1/properties/{propertyId}/…. The property
 * id comes only from the path; access to it is checked before anything else
 * is parsed. Inaccessible and non-existent properties are indistinguishable
 * (403), so ids cannot be probed.
 */
export function definePropertyRoute<P extends { propertyId: string }, Q = undefined, B = undefined>(
  options: CommonOptions<P, Q, B> & {
    params: z.ZodType<P>;
    permission?: Permission;
    /**
     * Financial commands: the `Idempotency-Key` header is required and passed
     * to the service as `idempotency` (null on routes without this flag).
     */
    idempotent?: boolean;
    handler: (
      args: Parsed<P, Q, B> & { ctx: PropertyContext; idempotency: IdempotencyRequest | null },
    ) => Promise<unknown>;
  },
): RouteFn {
  return (request, context) =>
    run(request, options, async (meta) => {
      const session = await authenticate(request, meta);
      if (options.rateLimit) {
        await enforceRateLimit(options.rateLimit, rateLimitKey(session.ctx));
      }
      const rawParams = await context.params;
      const propertyId = z.uuid().safeParse(rawParams.propertyId);
      if (!propertyId.success || !canAccessProperty(session.ctx.access, propertyId.data)) {
        throw new AppError("FORBIDDEN", "You do not have access to this property");
      }
      if (
        options.permission &&
        !hasPermission(session.ctx.access, propertyId.data, options.permission)
      ) {
        throw forbidden(options.permission);
      }
      const property = session.properties.find((p) => p.id === propertyId.data);
      if (!property) throw new AppError("FORBIDDEN", "You do not have access to this property");

      const parsed = await parse(request, context, options);
      assertReasonForHighRisk(request, options.permission, parsed.body);
      const idempotency = options.idempotent ? idempotencyOf(request, parsed.body) : null;

      const ctx: PropertyContext = {
        ...session.ctx,
        propertyId: property.id,
        propertyCode: property.code,
        timezone: property.timezone,
        currencyCode: property.currencyCode,
        // Read with the session's properties in this request (M10).
        businessDate: session.session.businessDates[property.id] ?? null,
      };
      return options.handler({ ...parsed, ctx, idempotency });
    });
}

// ---------------------------------------------------------------------------

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;

/**
 * Reads the client's Idempotency-Key and fingerprints the request (method,
 * path and the validated body), so a key reused for a different request is
 * detected instead of replaying the wrong response.
 */
function idempotencyOf(request: NextRequest, body: unknown): IdempotencyRequest {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new AppError(
      "VALIDATION_FAILED",
      "An Idempotency-Key header (16-80 letters, digits, '-' or '_') is required",
      { fields: { "Idempotency-Key": ["Missing or invalid"] } },
    );
  }
  const route = `${request.method} ${request.nextUrl.pathname}`.slice(0, 200);
  const requestHash = createHash("sha256")
    .update(`${route} ${JSON.stringify(body ?? null)}`)
    .digest("hex");
  return { key, route, requestHash };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Coarse flood guard before authentication; per-route limits follow per user. */
const GLOBAL_WRITE_LIMIT: RateLimitRule = { name: "api.write.ip", limit: 300, windowMs: 60_000 };

/** Authentication time per request, for the opt-in Server-Timing header. */
const authTimings = new WeakMap<NextRequest, number>();
/** Further named timings a handler reports (e.g. per search type). */
const extraTimings = new WeakMap<NextRequest, string[]>();

/** Whether handlers should measure parts of their work for Server-Timing. */
export function serverTimingEnabled(): boolean {
  return serverEnv().SERVER_TIMING === "1";
}

/** Adds `name;dur=…` to this request's opt-in Server-Timing header (no-op when off). */
export function addServerTiming(request: NextRequest, name: string, ms: number): void {
  if (!serverTimingEnabled() || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)) return;
  const list = extraTimings.get(request) ?? [];
  list.push(`${name};dur=${ms.toFixed(1)}`);
  extraTimings.set(request, list);
}

function serverTiming(
  request: NextRequest,
  started: number,
  pool: PoolUsage | null,
): string | null {
  if (!serverTimingEnabled()) return null;
  const total = performance.now() - started;
  const auth = authTimings.get(request);
  return [
    ...(auth === undefined ? [] : [`auth;dur=${auth.toFixed(1)}`]),
    ...(extraTimings.get(request) ?? []),
    // Waiting for pooled connections; desc: checkouts / newly opened connections.
    ...(pool
      ? [`db-acquire;dur=${pool.waitMs.toFixed(1)};desc="${pool.acquisitions}/${pool.opened}"`]
      : []),
    // Where replica-eligible reads ran: primary (no replica or not eligible),
    // replica, or fallback (replica unhealthy, lagging or failed). No hosts.
    ...(pool && Object.keys(pool.reads).length > 0
      ? [
          `db-read;desc="${Object.entries(pool.reads)
            .map(([route, count]) => `${route}=${count}`)
            .join(" ")}"`,
        ]
      : []),
    `total;dur=${total.toFixed(1)}`,
  ].join(", ");
}

async function run(
  request: NextRequest,
  options: { status?: number },
  execute: (meta: RequestMeta) => Promise<unknown>,
): Promise<Response> {
  const started = performance.now();
  const meta = requestMeta(request);
  // Pool waits of this request: Server-Timing (opt-in) and the slow-request log.
  const pool: PoolUsage = { waitMs: 0, acquisitions: 0, opened: 0, reads: {} };
  const handle = async () => {
    if (MUTATING.has(request.method)) {
      assertSameOrigin(request);
      await enforceRateLimit(GLOBAL_WRITE_LIMIT, rateLimitKey(meta));
    }
    return execute(meta);
  };
  try {
    // Counted for the graceful shutdown (lib/lifecycle/shutdown.ts).
    const result = await trackRequest(() => withPoolUsage(pool, handle));
    const response =
      result instanceof Response
        ? result
        : result instanceof WithMeta
          ? ok(result.data, result.meta, { status: options.status ?? 200 })
          : ok(result, undefined, { status: options.status ?? 200 });
    response.headers.set("x-request-id", meta.requestId);
    // Event streams keep no-transform: compression would buffer them.
    const eventStream = response.headers.get("content-type")?.startsWith("text/event-stream");
    response.headers.set("cache-control", eventStream ? "no-store, no-transform" : "no-store");
    const timing = serverTiming(request, started, pool);
    // Which instance answered (load tests, multi-instance QA); never in normal operation.
    if (timing) response.headers.set("x-instance-id", instanceId());
    if (timing) response.headers.set("server-timing", timing);
    observe(request, meta, started, pool, response.status);
    return response;
  } catch (error) {
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (serverTimingEnabled()) headers["x-instance-id"] = instanceId();
    if (
      error instanceof AppError &&
      error.code === "RATE_LIMITED" &&
      error.details?.retryAfterSeconds
    ) {
      headers["retry-after"] = String(error.details.retryAfterSeconds);
    }
    const response = toErrorResponse(error, meta.requestId, headers);
    observe(request, meta, started, pool, response.status);
    return response;
  }
}

/**
 * Request metrics (GET /api/metrics) and one log line for a slow request, with
 * what correlates it: request id, instance, route template, status, timings.
 * Never the path's ids, the query string, the body or the user.
 */
function observe(
  request: NextRequest,
  meta: RequestMeta,
  started: number,
  pool: PoolUsage,
  status: number,
) {
  const ms = performance.now() - started;
  recordRequest(request.method, request.nextUrl.pathname, status, ms / 1000);
  const slow = serverEnv().SLOW_REQUEST_MS;
  if (slow > 0 && ms >= slow) {
    console.warn(
      JSON.stringify({
        msg: "slow request",
        requestId: meta.requestId,
        instance: instanceId(),
        method: request.method,
        route: routeTemplate(request.nextUrl.pathname),
        status,
        ms: Math.round(ms),
        authMs: Math.round(authTimings.get(request) ?? 0),
        dbWaitMs: Math.round(pool.waitMs),
        dbCheckouts: pool.acquisitions,
      }),
    );
  }
}

function requestMeta(request: NextRequest): RequestMeta {
  // The load balancer's id (X-Request-Id), else a W3C traceparent's trace id,
  // else a new one: the same id then appears in logs, audit rows and jobs.
  const incoming = request.headers.get("x-request-id");
  const trace = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(
    request.headers.get("traceparent") ?? "",
  )?.[1];
  const requestId =
    incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
      ? incoming
      : trace && !/^0+$/.test(trace)
        ? trace
        : randomUUID();
  // Only the hops written by our own reverse proxies are trusted (D44); the
  // same address is used for rate limits, sessions and audit rows.
  const ipAddress = resolveClientIp(request.headers, serverEnv().TRUSTED_PROXY_HOPS);
  return {
    requestId,
    ipAddress,
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}

/**
 * CSRF defence for cookie-authenticated writes: the Origin must be our own.
 * In production that is APP_URL only (L3): the request's own Host-derived
 * origin is not trusted there, since a rebinding hostname would match itself.
 * Development and tests also accept the Host origin (any local port).
 */
export function allowedOrigins(
  env: { APP_URL: string; NODE_ENV: string },
  requestOrigin: string,
): Set<string> {
  const allowed = new Set([new URL(env.APP_URL).origin]);
  if (env.NODE_ENV !== "production") allowed.add(requestOrigin);
  return allowed;
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins(serverEnv(), request.nextUrl.origin);
  if (!origin || !allowed.has(origin)) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  }
}

/** A null key (anonymous request whose IP is unknown) is not IP-limited: see D44. */
async function enforceRateLimit(rule: RateLimitRule, key: string | null) {
  if (key === null) return;
  const result = await consumeRateLimit(rule, key);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

async function authenticate(request: NextRequest, meta: RequestMeta) {
  const started = performance.now();
  const claims = await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value);
  const session = claims ? await resolveSession(claims) : null;
  authTimings.set(request, performance.now() - started);
  if (!session)
    throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  const ctx: SessionContext = {
    ...meta,
    userId: session.user.id,
    organizationId: session.user.organizationId,
    sessionId: session.sessionId,
    access: session.access,
  };
  return { ctx, session, properties: session.properties };
}

async function parse<P, Q, B>(
  request: NextRequest,
  context: RouteContextArg,
  schemas: Schemas<P, Q, B>,
): Promise<Parsed<P, Q, B>> {
  const params = schemas.params ? schemas.params.parse(await context.params) : (undefined as P);
  const query = schemas.query
    ? schemas.query.parse(Object.fromEntries(request.nextUrl.searchParams))
    : (undefined as Q);

  let body = undefined as B;
  if (schemas.body) {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new AppError("VALIDATION_FAILED", "Expected a JSON request body");
    }
    const text = await readBodyText(request);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_FAILED", "Malformed JSON request body");
    }
    body = schemas.body.parse(raw);
  }
  return { request, params, query, body };
}

/**
 * Largest JSON request body accepted (the biggest legitimate one, an avatar,
 * is ≈ 350 KB of base64). Checked against Content-Length and again while the
 * body streams in (chunked requests have no length), so an oversized body is
 * never buffered: without it one anonymous sign-in request could make the
 * process read and parse hundreds of megabytes.
 */
export const MAX_JSON_BODY_BYTES = 1_048_576;

function payloadTooLarge(): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", "The request body is too large", {
    limitBytes: MAX_JSON_BODY_BYTES,
  });
}

async function readBodyText(request: NextRequest): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) throw payloadTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** High-risk permissions demand a written reason on state-changing requests (docs/RBAC.md §2). */
function assertReasonForHighRisk(
  request: NextRequest,
  permission: Permission | undefined,
  body: unknown,
) {
  if (!permission || !isHighRisk(permission) || !MUTATING.has(request.method)) return;
  const reason = (body as { reason?: unknown } | undefined)?.reason;
  if (typeof reason !== "string" || reason.trim().length < 3) {
    throw new AppError("VALIDATION_FAILED", "A reason is required for this action", {
      fields: { reason: ["A reason is required for this action"] },
    });
  }
}
