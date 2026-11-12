import { Redis } from "ioredis";
import { serverEnv } from "@/config/env";
import { onShutdown } from "@/lib/lifecycle/shutdown";
import { logServerError } from "@/lib/log";

/**
 * Optional Redis connection (S4). Only created when REDIS_URL is set, and only
 * on first use (lazy connect). The application never depends on it: while the
 * connection is not ready, `getRedis()` returns null and callers (lib/cache.ts)
 * fall back to the in-process memory cache. Connection errors are logged at
 * most once a minute and never thrown, so a Redis outage cannot take the
 * process down.
 */

const holder = globalThis as unknown as { __sereneRedis?: Redis | null };
let lastErrorLog = 0;

function createClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    // Fail fast instead of queueing commands while disconnected: callers fall back.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });
  client.on("error", (error: unknown) => {
    const now = Date.now();
    if (now - lastErrorLog < 60_000) return;
    lastErrorLog = now;
    logServerError("redis", error);
  });
  onShutdown("redis", "close", async () => {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  });
  return client;
}

/** The Redis client when configured and currently connected; otherwise null. */
export function getRedis(): Redis | null {
  const url = serverEnv().REDIS_URL;
  if (!url) return null;
  if (holder.__sereneRedis === undefined) {
    holder.__sereneRedis = createClient(url);
    holder.__sereneRedis.connect().catch(() => undefined); // errors are reported by the listener
  }
  const client = holder.__sereneRedis;
  return client && client.status === "ready" ? client : null;
}

/** Whether Redis is configured at all (not whether it is up right now). */
export function redisConfigured(): boolean {
  return Boolean(serverEnv().REDIS_URL);
}

/** Test seam: drop the client so the next use reconnects (or stays off). */
export function resetRedisForTests(): void {
  holder.__sereneRedis?.disconnect();
  holder.__sereneRedis = undefined;
}
