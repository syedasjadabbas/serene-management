import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { serverEnv } from "@/lib/env";
import { type Permission, isHighRisk } from "@/lib/permissions/catalog";
import {
  canAccessProperty,
  hasOrganizationPermission,
  hasPermission,
} from "@/lib/permissions/evaluate";
import { type ResolvedSession, resolveSession } from "@/modules/access/access.service";
import { getCurrentBusinessDate } from "@/modules/business-date/business-date.service";
import type { PropertyContext, RequestMeta, SessionContext } from "./context";
import { AppError, forbidden } from "./errors";
import { consumeRateLimit, type RateLimitRule } from "./rate-limit";
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
  /** Extra per-route limit; its key is the client IP. */
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
    handler: (args: Parsed<P, Q, B> & { ctx: PropertyContext }) => Promise<unknown>;
  },
): RouteFn {
  return (request, context) =>
    run(request, options, async (meta) => {
      const session = await authenticate(request, meta);
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

      const ctx: PropertyContext = {
        ...session.ctx,
        propertyId: property.id,
        propertyCode: property.code,
        timezone: property.timezone,
        businessDate: await getCurrentBusinessDate(property.id),
      };
      return options.handler({ ...parsed, ctx });
    });
}

// ---------------------------------------------------------------------------

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const GLOBAL_WRITE_LIMIT: RateLimitRule = { name: "api.write.ip", limit: 300, windowMs: 60_000 };

async function run(
  request: NextRequest,
  options: { rateLimit?: RateLimitRule; status?: number },
  execute: (meta: RequestMeta) => Promise<unknown>,
): Promise<Response> {
  const meta = requestMeta(request);
  try {
    if (MUTATING.has(request.method)) {
      assertSameOrigin(request);
      enforceRateLimit(GLOBAL_WRITE_LIMIT, meta);
    }
    if (options.rateLimit) enforceRateLimit(options.rateLimit, meta);

    const result = await execute(meta);
    const response =
      result instanceof Response
        ? result
        : result instanceof WithMeta
          ? ok(result.data, result.meta, { status: options.status ?? 200 })
          : ok(result, undefined, { status: options.status ?? 200 });
    response.headers.set("x-request-id", meta.requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (
      error instanceof AppError &&
      error.code === "RATE_LIMITED" &&
      error.details?.retryAfterSeconds
    ) {
      headers["retry-after"] = String(error.details.retryAfterSeconds);
    }
    return toErrorResponse(error, meta.requestId, headers);
  }
}

function requestMeta(request: NextRequest): RequestMeta {
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  // X-Forwarded-For is trusted only because the app is deployed behind our own
  // reverse proxy, which overwrites it (docs/ARCHITECTURE.md §9).
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwarded || request.headers.get("x-real-ip") || null;
  return {
    requestId,
    ipAddress: ipAddress ? ipAddress.slice(0, 45) : null,
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}

/** CSRF defence for cookie-authenticated writes: the Origin must be our own. */
function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = new Set([request.nextUrl.origin, new URL(serverEnv().APP_URL).origin]);
  if (!origin || !allowed.has(origin)) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  }
}

function enforceRateLimit(rule: RateLimitRule, meta: RequestMeta) {
  const result = consumeRateLimit(rule, meta.ipAddress ?? "unknown");
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

async function authenticate(request: NextRequest, meta: RequestMeta) {
  const claims = await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value);
  const session = claims ? await resolveSession(claims) : null;
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
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AppError("VALIDATION_FAILED", "Malformed JSON request body");
    }
    body = schemas.body.parse(raw);
  }
  return { request, params, query, body };
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
