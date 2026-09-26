import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at first use. Never import from client
 * code: secrets must not reach the browser bundle.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  /** HMAC key for access-token JWTs (HS256). */
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
  /** HMAC key (pepper) for hashing refresh and password-reset tokens at rest. */
  AUTH_REFRESH_TOKEN_SECRET: z.string().min(32),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(1_209_600),
  FIELD_ENCRYPTION_KEY: z.string().optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  /**
   * Number of reverse proxies in front of the app that append to
   * X-Forwarded-For (D44). 0 = no proxy: forwarded headers are ignored and
   * the client IP is unknown. Set it to the real proxy count in production.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
