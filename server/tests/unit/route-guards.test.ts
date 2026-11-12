import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guard for direct API access: authentication, property access and
 * the cookie origin check are middlewares spelled out per route in
 * modules/<feature>/<feature>.routes.ts, so a route registered without them
 * would be reachable regardless of what the UI hides.
 */
const MODULES_ROOT = join(process.cwd(), "modules");
const REGISTRATION = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"([\s\S]*?)\);/g;

/** The only unauthenticated endpoints: probes, the metrics scrape and the sign-in flow. */
const PUBLIC_ROUTES = new Set([
  "GET /health",
  "GET /health/live",
  "GET /health/ready",
  // Internal scrape endpoint: no session, but 404 unless METRICS_TOKEN is sent
  // as a bearer token (tests/integration/observability.test.ts).
  "GET /metrics",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/password/reset",
  "POST /auth/refresh",
]);
/** Endpoints that read the refresh cookie: they must carry the Origin check. */
const COOKIE_ROUTES = new Set(["POST /auth/logout", "POST /auth/refresh"]);

function routerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routerFiles(path);
    return entry.name.endsWith(".routes.ts") ? [path] : [];
  });
}

const routes = routerFiles(MODULES_ROOT).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(REGISTRATION)].map(([, method, path, rest]) => ({
    key: `${method!.toUpperCase()} ${path}`,
    path: path!,
    pipeline: rest!,
    file,
  }));
});

describe("API route guards", () => {
  it("finds the converted routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it("allows unauthenticated access only to health probes and the sign-in flow", () => {
    const publicRoutes = routes.filter(({ pipeline }) => !/\brequireAuth\b/.test(pipeline));
    expect(new Set(publicRoutes.map(({ key }) => key))).toEqual(PUBLIC_ROUTES);
  });

  it("keeps every property-scoped route behind requireAuth then propertyScope", () => {
    const offenders = routes
      .filter(({ path }) => path.startsWith("/properties/:propertyId"))
      .filter(({ pipeline }) => {
        const auth = pipeline.search(/\brequireAuth\b/);
        const scope = pipeline.search(/\bpropertyScope\b/);
        return auth < 0 || scope < auth;
      })
      .map(({ key }) => key);
    expect(offenders).toEqual([]);
  });

  it("never lets a non-property route use propertyScope or property permissions", () => {
    const offenders = routes
      .filter(({ path }) => !path.startsWith("/properties/:propertyId"))
      .filter(({ pipeline }) => /\bpropertyScope\b|\brequirePermission\(/.test(pipeline))
      .map(({ key }) => key);
    expect(offenders).toEqual([]);
  });

  it("puts the Origin check on the cookie endpoints", () => {
    for (const route of routes) {
      const has = /\bsameOrigin\b/.test(route.pipeline);
      expect(has, route.key).toBe(COOKIE_ROUTES.has(route.key));
    }
  });

  it("registers every route with a controller as its last handler", () => {
    for (const route of routes) {
      const last = route.pipeline
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .pop()!;
      expect(last, route.key).toMatch(/^controller\.\w+$/);
    }
  });
});
