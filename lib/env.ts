import "server-only";
import { z } from "zod";

/**
 * Server environment (docs/DEPLOYMENT.md). Validated when the server starts
 * (instrumentation.ts) and by the operational scripts, so a misconfigured
 * production process fails before serving traffic instead of on the first
 * request that reads a variable. Never import from client code.
 *
 * Development and test keep convenient defaults; NODE_ENV=production adds
 * the rules below (M6). Error messages name variables, never their values.
 */

const TTL_MAX_REFRESH_SECONDS = 90 * 24 * 60 * 60;

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "Must be a postgresql:// URL"),
  /** HMAC key for access-token JWTs (HS256). */
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
  /** HMAC key (pepper) for hashing refresh and password-reset tokens at rest. */
  AUTH_REFRESH_TOKEN_SECRET: z.string().min(32),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(TTL_MAX_REFRESH_SECONDS)
    .default(1_209_600),
  /**
   * AES-256-GCM key for sensitive profile fields (guest ID documents). Not
   * used by any feature yet, so optional; when set it must be 32 bytes.
   */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine(
      (value) => !value || decodedLength(value) === 32,
      "Must be 32 random bytes, base64-encoded",
    ),
  APP_URL: z.url().default("http://localhost:3000"),
  /**
   * Number of reverse proxies in front of the app that append to
   * X-Forwarded-For (D44). 0 = no proxy: forwarded headers are ignored and
   * the client IP is unknown. Set it to the real proxy count in production.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Schema owner connection used only by migrations and the backup commands
   * (docs/OPERATIONS.md §4). When unset, DATABASE_URL is used for both.
   */
  MIGRATION_DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "Must be a postgresql:// URL")
    .optional(),
  /**
   * Connection pool and session limits (lib/db/pool-config.ts, D52). The
   * defaults suit one application process on a small hotel server; tune
   * against the PostgreSQL max_connections budget, never blindly upwards.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  /**
   * "1" adds a Server-Timing header (authentication and total milliseconds)
   * to API responses, for load tests (docs/SCALABILITY.md). Off by default:
   * timings are not shown to clients in normal operation.
   */
  SERVER_TIMING: z.enum(["0", "1"]).default("0"),
});

export type ServerEnv = z.infer<typeof baseSchema>;

/** Fragments of example or placeholder values that must never reach production. */
const PLACEHOLDER_FRAGMENTS = ["change-me", "changeme", "example", "placeholder", "your-", "xxxx"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

function decodedLength(value: string): number {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return -1;
  return Buffer.from(value, "base64").length;
}

/** A secret that looks generated: long, varied and not a placeholder. */
function weakSecretReason(value: string): string | null {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    return "Looks like a placeholder; generate a random secret (openssl rand -base64 48)";
  }
  if (new Set(value).size < 16) {
    return "Not random enough; generate a random secret (openssl rand -base64 48)";
  }
  return null;
}

/**
 * Validates an environment object. Pure (no caching) so it can be tested;
 * `serverEnv()` is the cached accessor used by the application.
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
  options: { productionRules?: boolean } = {},
): { success: true; data: ServerEnv } | { success: false; error: string } {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    return { success: false, error: z.prettifyError(parsed.error) };
  }
  const env = parsed.data;
  const productionRules = options.productionRules ?? env.NODE_ENV === "production";
  if (!productionRules) return { success: true, data: env };

  const problems: string[] = [];
  const add = (variable: string, message: string) =>
    problems.push(`✖ ${message}\n  → at ${variable}`);

  // APP_URL: explicit, public and HTTPS (cookies are Secure, the Origin check compares it).
  if (!source.APP_URL) add("APP_URL", "Required in production (the public https:// URL)");
  const appUrl = new URL(env.APP_URL);
  if (appUrl.protocol !== "https:") add("APP_URL", "Must use https:// in production");
  if (LOCAL_HOSTS.has(appUrl.hostname)) add("APP_URL", "Must not point to localhost in production");

  for (const variable of ["AUTH_ACCESS_TOKEN_SECRET", "AUTH_REFRESH_TOKEN_SECRET"] as const) {
    const reason = weakSecretReason(env[variable]);
    if (reason) add(variable, reason);
  }
  if (env.AUTH_ACCESS_TOKEN_SECRET === env.AUTH_REFRESH_TOKEN_SECRET) {
    add("AUTH_REFRESH_TOKEN_SECRET", "Must differ from AUTH_ACCESS_TOKEN_SECRET");
  }
  if (env.AUTH_REFRESH_TOKEN_TTL_SECONDS <= env.AUTH_ACCESS_TOKEN_TTL_SECONDS) {
    add("AUTH_REFRESH_TOKEN_TTL_SECONDS", "Must be longer than AUTH_ACCESS_TOKEN_TTL_SECONDS");
  }

  const database = new URL(env.DATABASE_URL);
  const password = decodeURIComponent(database.password);
  if (!password || PLACEHOLDER_FRAGMENTS.some((f) => password.toLowerCase().includes(f))) {
    add("DATABASE_URL", "Needs the real database password (placeholder or empty)");
  }

  // The proxy topology decides which client IP is trusted (D44): it must be
  // stated, even when it is 0 (no reverse proxy).
  if (source.TRUSTED_PROXY_HOPS === undefined || source.TRUSTED_PROXY_HOPS.trim() === "") {
    add("TRUSTED_PROXY_HOPS", "Required in production (0 = no reverse proxy, 1 = one proxy …)");
  }

  if (problems.length > 0) return { success: false, error: problems.join("\n") };
  return { success: true, data: env };
}

let cached: ServerEnv | undefined;

/** True while `next build` runs (page-data collection imports server modules). */
function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function serverEnv(): ServerEnv {
  if (!cached) {
    // The build machine need not hold production secrets or the public URL,
    // so `next build` checks only the base rules and caches nothing. The
    // production rules apply when the server starts (instrumentation.ts)
    // and in the operational commands.
    const building = isBuildPhase();
    const parsed = parseServerEnv(process.env, building ? { productionRules: false } : {});
    if (!parsed.success) {
      throw new Error(`Invalid server environment:\n${parsed.error}`);
    }
    if (building) return parsed.data;
    cached = parsed.data;
  }
  return cached;
}
