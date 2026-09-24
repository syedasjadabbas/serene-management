import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";

/**
 * Calls exported App Router route handlers directly with real Request
 * objects, carrying cookies between calls like a browser would.
 */

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

export const ORIGIN = "http://localhost:3000";

export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string) {
    return this.cookies.get(name);
  }

  set(name: string, value: string) {
    this.cookies.set(name, value);
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export interface CallOptions {
  method?: string;
  path: string;
  params?: Record<string, string>;
  body?: unknown;
  jar?: CookieJar;
  headers?: Record<string, string>;
  /** Omit the Origin header (to test CSRF protection). */
  noOrigin?: boolean;
  /** Simulated client IP, so per-IP rate limits do not couple unrelated tests. */
  ip?: string;
}

export interface CallResult<T = unknown> {
  status: number;
  body: T;
  response: Response;
}

// Response bodies are arbitrary JSON inspected by assertions; `any` keeps test code readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  handler: RouteHandler,
  options: CallOptions,
): Promise<CallResult<T>> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.ip ?? testIp());
  headers.set("user-agent", "vitest-integration");
  if (method !== "GET" && !options.noOrigin) headers.set("origin", ORIGIN);
  if (options.jar) headers.set("cookie", options.jar.header());
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  const request = new NextRequest(new URL(options.path, ORIGIN), { method, headers, body });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  options.jar?.absorb(response);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T, response };
}

let ipCounter = 0;
/** A fresh documentation-range IP per call site (rate limits are per IP). */
export function testIp() {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export async function loginAs(email: string, password: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const result = await call(loginRoute, {
    method: "POST",
    path: "/api/v1/auth/login",
    body: { email, password },
    jar,
  });
  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return jar;
}

export function uniqueSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}
