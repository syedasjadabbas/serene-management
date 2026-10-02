import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guard for direct API access: authentication, property access
 * and rate limiting live in the route wrappers (lib/http/route.ts), so a
 * handler that bypasses them would be reachable regardless of what the UI
 * hides.
 */
const API_ROOT = join(process.cwd(), "app", "api");
const HANDLER = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*(\w+)/g;
const RAW_HANDLER = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/;

/** The only unauthenticated endpoints: probes and the sign-in flow. */
const PUBLIC_ROUTES = new Set([
  "health",
  "health/live",
  "health/ready",
  // Internal scrape endpoint: no session, but 404 unless METRICS_TOKEN is sent
  // as a bearer token (tests/integration/observability.test.ts).
  "metrics",
  "v1/auth/login",
  "v1/auth/logout",
  "v1/auth/password/reset",
  "v1/auth/refresh",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

const routes = routeFiles(API_ROOT).map((file) => {
  const route = relative(API_ROOT, file).split(sep).slice(0, -1).join("/");
  const source = readFileSync(file, "utf8");
  const handlers = [...source.matchAll(HANDLER)].map(([, method, wrapper]) => ({
    method: method!,
    wrapper: wrapper!,
  }));
  return { route, source, handlers };
});

describe("API route guards", () => {
  it("finds the route tree", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it.each(routes)("$route exports only wrapped handlers", ({ source, handlers }) => {
    expect(RAW_HANDLER.test(source)).toBe(false);
    expect(handlers.length).toBeGreaterThan(0);
    for (const { wrapper } of handlers) {
      expect(["definePublicRoute", "defineSessionRoute", "definePropertyRoute"]).toContain(wrapper);
    }
  });

  it("keeps every property-scoped route behind the property access check", () => {
    const offenders = routes
      .filter(({ route }) => route.startsWith("v1/properties/[propertyId]"))
      .flatMap(({ route, handlers }) =>
        handlers
          .filter(({ wrapper }) => wrapper !== "definePropertyRoute")
          .map(({ method }) => `${method} ${route}`),
      );
    expect(offenders).toEqual([]);
  });

  it("allows unauthenticated access only to health probes and sign-in", () => {
    const publicRoutes = routes
      .filter(({ handlers }) => handlers.some(({ wrapper }) => wrapper === "definePublicRoute"))
      .map(({ route }) => route);
    expect(new Set(publicRoutes)).toEqual(PUBLIC_ROUTES);
  });
});
