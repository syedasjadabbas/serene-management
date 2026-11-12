import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

/**
 * Server environment (docs/DEPLOYMENT.md). Validated when the server starts
 * (index.ts) and by the operational scripts, so a misconfigured
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
  /** Port the Express server listens on. */
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  /**
   * Browser origins allowed to call the API (CORS allowlist and the Origin
   * check of the cookie endpoints /auth/refresh and /auth/logout): a comma
   * separated list of origins, e.g. "https://pms.example.com". Replaces APP_URL.
   */
  CLIENT_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .pipe(
      z
        .array(
          z.string().refine((entry) => {
            try {
              const url = new URL(entry);
              return (
                (url.protocol === "http:" || url.protocol === "https:") && url.origin === entry
              );
            } catch {
              return false;
            }
          }, "Each entry must be an origin such as https://pms.example.com (no path, no trailing slash)"),
        )
        .min(1),
    ),
  /**
   * Optional Redis (lib/redis.ts). Set: session, permission and other caches
   * are shared by every instance. Unset (development, CI): caches live in
   * process memory with short TTLs. A Redis outage falls back to memory.
   */
  REDIS_URL: z
    .url()
    .refine((value) => /^rediss?:\/\//.test(value), "Must be a redis:// or rediss:// URL")
    .optional(),
  /** How long a resolved session is cached (ms). Default 30 s with Redis, 10 s in memory. */
  SESSION_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).optional(),
  /** How long a user's resolved permissions are cached (ms). Default 30 s with Redis, 10 s in memory. */
  PERMISSION_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).optional(),
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
  /** Idle connections kept open at least (0: all may close when idle). */
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(50).default(0),
  /**
   * An idle pooled connection above the minimum is closed after this long.
   * 120 s (measured, docs/SCALABILITY.md §32): with 30 s, the live-update
   * refetch waves (≈60 s apart) found the pool closed and reopened connections.
   */
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(120_000),
  /** A pooled connection is replaced after this many seconds (0: never). */
  DATABASE_POOL_MAX_LIFETIME_S: z.coerce.number().int().min(0).max(86_400).default(0),
  /**
   * What DATABASE_URL points at (docs/OPERATIONS.md §6): "none" (PostgreSQL
   * itself) or "pgbouncer-transaction" (a transaction-mode PgBouncer: session
   * settings are not sent as startup options, set them on the runtime role).
   */
  DATABASE_POOLER: z.enum(["none", "pgbouncer-transaction"]).default("none"),
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
  /**
   * Where rate-limit windows are counted (lib/http/rate-limit.ts): "postgres"
   * (default; shared by every instance) or "memory" (one process only: never
   * with more than one application instance).
   */
  RATE_LIMIT_STORE: z.enum(["postgres", "memory"]).default("postgres"),
  /**
   * Global search: how many of its per-type queries one request runs at the
   * same time (modules/search, docs/SCALABILITY.md §28). Each holds a pool
   * connection while it runs; keep it well below DATABASE_POOL_MAX.
   */
  SEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  /**
   * Live updates (lib/realtime, docs/SCALABILITY.md §31): "1" (default)
   * serves the event streams that replace polling on the front desk, room
   * board, housekeeping and business date; "0" answers 503 and every screen
   * polls as before.
   */
  REALTIME_ENABLED: z.enum(["0", "1"]).default("1"),
  /**
   * Connection for the one LISTEN session each instance holds. LISTEN needs a
   * session connection: set this to a direct URL when DATABASE_URL goes
   * through a transaction-pooling PgBouncer. When unset, DATABASE_URL is used.
   */
  REALTIME_DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "Must be a postgresql:// URL")
    .optional(),
  /**
   * Optional read replica (lib/db/read-replica.ts, docs/SCALABILITY.md §35).
   * Unset (the default): every query uses DATABASE_URL, as before. When set,
   * only explicitly approved, staleness-tolerant reads (closed-date reports)
   * may run there; everything else stays on the primary.
   */
  READ_DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "Must be a postgresql:// URL")
    .optional(),
  /**
   * Graceful shutdown (lib/lifecycle/shutdown.ts, docs/OPERATIONS.md §10): how
   * long readiness fails before the instance stops taking requests (keep it at
   * least the load balancer's health-check interval × unhealthy threshold),
   * and the bound on the whole shutdown (in-flight requests, running jobs).
   */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(25_000),
  /**
   * Bearer token for GET /api/metrics (Prometheus / OpenMetrics text,
   * docs/OPERATIONS.md §11). Unset: the endpoint answers 404. At least 32
   * characters; a scraper secret, never a user credential.
   */
  METRICS_TOKEN: z.string().min(32).optional(),
  /** API requests slower than this are logged once (request id, route, status, timings); 0 = off. */
  SLOW_REQUEST_MS: z.coerce.number().int().min(0).max(600_000).default(2_000),
  /** Names this process in observability output; default host-pid-random. No secrets. */
  INSTANCE_ID: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,64}$/, "Letters, digits, . _ : - only (≤ 64)")
    .optional(),
  /** Connections per process to the read replica (counts against its max_connections). */
  READ_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(3),
  /** A replica further behind the primary than this is not used (reads go to the primary). */
  READ_REPLICA_MAX_LAG_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  /**
   * Heavy reports (modules/reports HEAVY_REPORT_KEYS, docs/SCALABILITY.md §33):
   * how many one application process computes at the same time. Further
   * requests wait up to REPORT_HEAVY_WAIT_MS, then answer 429 REPORTS_BUSY.
   * 1 (measured): four users exporting the guest ledger back to back cost
   * everyone else 21 % of throughput instead of 41 %; 2 was no better than
   * no limit.
   */
  REPORT_HEAVY_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  REPORT_HEAVY_WAIT_MS: z.coerce.number().int().min(0).max(120_000).default(30_000),
  /**
   * Background jobs (modules/jobs, docs/SCALABILITY.md §33): "inline" (default)
   * runs a worker inside every application process; "off" leaves the jobs to
   * separate worker processes (`npm run worker`). Any mix is safe: jobs are
   * claimed atomically, never twice.
   */
  JOB_WORKER: z.enum(["inline", "off"]).default("inline"),
  /** Jobs one worker process executes at the same time. */
  JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /** Idle workers look for due jobs this often (inserts also wake them at once). */
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  /**
   * A claimed job is the worker's for this long, renewed by heartbeat every
   * third of it; a worker that dies is replaced once its lease expires.
   */
  JOB_LEASE_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
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
  const problems: string[] = [];
  const add = (variable: string, message: string) =>
    problems.push(`✖ ${message}\n  → at ${variable}`);

  // Connection topology (docs/OPERATIONS.md §6), in every environment.
  if (env.DATABASE_POOL_MIN > env.DATABASE_POOL_MAX) {
    add("DATABASE_POOL_MIN", "Must not exceed DATABASE_POOL_MAX");
  }
  if (
    env.DATABASE_POOLER === "pgbouncer-transaction" &&
    env.REALTIME_ENABLED === "1" &&
    !env.REALTIME_DATABASE_URL
  ) {
    // LISTEN holds a session: through a transaction-mode pooler it would
    // silently receive nothing.
    add(
      "REALTIME_DATABASE_URL",
      "Required with DATABASE_POOLER=pgbouncer-transaction: a direct (session) connection for LISTEN",
    );
  }
  if (problems.length > 0) return { success: false, error: problems.join("\n") };

  const productionRules = options.productionRules ?? env.NODE_ENV === "production";
  if (!productionRules) return { success: true, data: env };

  // CLIENT_ORIGINS: explicit, public and HTTPS (the refresh cookie is Secure, the Origin check compares it).
  if (!source.CLIENT_ORIGINS) {
    add("CLIENT_ORIGINS", "Required in production (the public https:// origin(s) of the web app)");
  }
  for (const origin of env.CLIENT_ORIGINS) {
    const url = new URL(origin);
    if (url.protocol !== "https:") add("CLIENT_ORIGINS", "Must use https:// in production");
    if (LOCAL_HOSTS.has(url.hostname)) {
      add("CLIENT_ORIGINS", "Must not point to localhost in production");
    }
  }

  for (const variable of ["AUTH_ACCESS_TOKEN_SECRET", "AUTH_REFRESH_TOKEN_SECRET"] as const) {
    const reason = weakSecretReason(env[variable]);
    if (reason) add(variable, reason);
  }
  if (env.METRICS_TOKEN) {
    const reason = weakSecretReason(env.METRICS_TOKEN);
    if (reason) add("METRICS_TOKEN", reason);
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
let dotenvLoaded = false;

/**
 * Loads `server/.env`, then the repository-root `.env`, without overriding
 * variables that are already set (real environment wins; the first file wins
 * over the second). Missing files are fine (production uses real env vars).
 * `config/` and `dist/` sit at the same depth, so the paths hold for the
 * source tree and for the bundled `dist/index.mjs`.
 */
export function loadEnvFiles(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  // Node's own parser (no dotenv at runtime: it is a development dependency).
  for (const relative of ["../.env", "../../.env"]) {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      process.env[key] ??= value;
    }
  }
}

export function serverEnv(): ServerEnv {
  if (!cached) {
    loadEnvFiles();
    const parsed = parseServerEnv(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid server environment:
${parsed.error}`);
    }
    cached = parsed.data;
  }
  return cached;
}
