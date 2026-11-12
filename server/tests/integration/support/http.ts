import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "@/app";
import type { SessionContext } from "@/lib/context";
import { verifyAccessToken } from "@/lib/jwt";
import { resolveSession } from "@/modules/access/access.service";

/**
 * Integration harness: supertest against `createApp()` (the real middleware
 * chain: auth, validation, error envelope), no network port.
 *
 *   const settle = route("POST", "/properties/:propertyId/folios/:folioId/settle");
 *   const res = await call(settle, { params: { propertyId, folioId }, body, jar });
 *
 * `route(method, path)` returns a descriptor; `call(descriptor, options)` fills
 * `params` into the path. Paths are relative to /api/v1; paths that start with
 * /api/ (health, metrics) are used as they are. `query` adds a query string.
 *
 * `jar` is a `Session`: the Bearer access token plus the refresh cookie, the
 * two things the browser holds. `call` absorbs them from responses (a body with
 * `data.accessToken`, the Set-Cookie of the refresh cookie) and sends them: the
 * Authorization header always, the refresh cookie only to /api/v1/auth/*, as
 * the cookie's Path would. `CookieJar` is kept as an alias of `Session`.
 */

export const ORIGIN = "http://localhost:3000";
export const REFRESH_COOKIE = "sm_rt";

export interface RouteDescriptor {
  method: string;
  path: string;
}

export function route(method: string, path: string): RouteDescriptor {
  return { method: method.toUpperCase(), path };
}

export class Session {
  /** The access token (Authorization: Bearer). */
  accessToken: string | undefined;
  /** The refresh cookie value. */
  refreshToken: string | undefined;

  absorb(response: { headers: Headers }, body?: unknown) {
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      if (pair.slice(0, index).trim() !== REFRESH_COOKIE) continue;
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      this.refreshToken = expired ? undefined : value;
    }
    const token = (body as { data?: { accessToken?: unknown } } | null)?.data?.accessToken;
    if (typeof token === "string") this.accessToken = token;
  }

  /** Cookie-style accessors: `REFRESH_COOKIE` is the only cookie there is. */
  get(name: string) {
    return name === REFRESH_COOKIE ? this.refreshToken : undefined;
  }

  set(name: string, value: string) {
    if (name === REFRESH_COOKIE) this.refreshToken = value;
  }
}
export { Session as CookieJar };

export interface CallOptions {
  /** Values for `:name` segments of the route path. */
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Session holding the Bearer token and refresh cookie. */
  jar?: Session;
  headers?: Record<string, string>;
  /** Omit the Origin header (to test the CSRF check of the cookie endpoints). */
  noOrigin?: boolean;
  /** Simulated client IP, so per-IP rate limits do not couple unrelated tests. */
  ip?: string;
  /** Send this raw text as the body instead of JSON-encoding `body`. */
  rawBody?: string;
  /** Content type of `rawBody` (default application/json). */
  contentType?: string;
}

/** The response as tests inspect it: status, parsed body and a fetch-like `response`. */
export interface CallResult<T = unknown> {
  status: number;
  body: T;
  response: { status: number; headers: Headers; text: string };
}

let cachedApp: Express | undefined;
export function app(): Express {
  cachedApp ??= createApp();
  return cachedApp;
}

function fill(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

// Response bodies are arbitrary JSON inspected by assertions; `any` keeps test code readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  target: RouteDescriptor,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const base = target.path.startsWith("/api/") ? target.path : `/api/v1${target.path}`;
  let path = fill(base, options.params);
  if (options.query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const text = search.toString();
    if (text) path += (path.includes("?") ? "&" : "?") + text;
  }

  const method = target.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  let req = request(app())[method](path).buffer(true);
  req = req.parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  });
  req.set("x-forwarded-for", options.ip ?? testIp());
  req.set("user-agent", "vitest-integration");
  if (method !== "get" && !options.noOrigin) req.set("origin", ORIGIN);
  if (options.jar?.accessToken) req.set("authorization", `Bearer ${options.jar.accessToken}`);
  if (options.jar?.refreshToken && path.startsWith("/api/v1/auth")) {
    req.set("cookie", `${REFRESH_COOKIE}=${options.jar.refreshToken}`);
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) req.set(name, value);
  if (options.rawBody !== undefined) {
    req.set("content-type", options.contentType ?? "application/json");
    req.send(options.rawBody);
  } else if (options.body !== undefined) {
    req.set("content-type", "application/json");
    req.send(JSON.stringify(options.body));
  }

  const res = await req;
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, String(value));
  }
  const buffer: Buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.alloc(0);
  const text = buffer.toString("utf8");
  const type = headers.get("content-type") ?? "";
  // JSON is parsed; text (CSV exports) stays text; anything else is the raw Buffer.
  const parsed = !text
    ? null
    : type.includes("json")
      ? JSON.parse(text)
      : /^text\/|csv/.test(type)
        ? text
        : buffer;
  options.jar?.absorb({ headers }, parsed);
  return {
    status: res.status,
    body: parsed as T,
    response: { status: res.status, headers, text },
  };
}

// Rate limits are shared by all test files through PostgreSQL (like instances in
// production), so each worker starts at a random point of the range: two files
// running in parallel must not share IP buckets.
let ipCounter = Math.floor(Math.random() * 60_000);
/** A fresh documentation-range IP per call site (rate limits are per IP). */
export function testIp() {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export const loginRoute = route("POST", "/auth/login");

/** Signs in and returns the Session (access token + refresh cookie). */
export async function loginAs(
  email: string,
  password: string,
  options: { platform?: "web" | "mobile"; jar?: Session } = {},
): Promise<Session> {
  const jar = options.jar ?? new Session();
  const result = await call(loginRoute, {
    body: { email, password },
    jar,
    headers: options.platform ? { "x-client-platform": options.platform } : undefined,
  });
  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return jar;
}

export function uniqueSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * The SessionContext of a signed-in Session, for tests that call services
 * directly (administration steps that have no converted route yet).
 */
export async function contextFor(jar: Session): Promise<SessionContext> {
  const claims = await verifyAccessToken(jar.accessToken);
  if (!claims) throw new Error("The session has no valid access token");
  const session = await resolveSession(claims);
  if (!session) throw new Error("The session is not active");
  return {
    requestId: "test-context",
    ipAddress: testIp(),
    userAgent: "vitest-integration",
    userId: session.user.id,
    organizationId: session.user.organizationId,
    sessionId: session.sessionId,
    access: session.access,
  };
}
