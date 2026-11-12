import { getRedis } from "@/lib/redis";
import { logServerError } from "@/lib/log";

/**
 * Small cache with Redis when available and a bounded in-process Map
 * otherwise (S4). Values must be JSON-serializable. Every Redis failure falls
 * back to memory for that operation; memory entries are capped at
 * MEMORY_MAX_TTL_MS so a Redis outage (or running without Redis) never leaves
 * long-lived stale data in one instance.
 */

const PREFIX = "serene:";
const MAX_MEMORY_ENTRIES = 10_000;
/** TTL ceiling for the memory cache (it is not shared between instances). */
export const MEMORY_MAX_TTL_MS = 10_000;

interface Entry {
  value: string;
  expiresAt: number;
}
const holder = globalThis as unknown as { __sereneMemoryCache?: Map<string, Entry> };
const memory = (holder.__sereneMemoryCache ??= new Map<string, Entry>());
let lastLog = 0;

function reportRedisFailure(error: unknown) {
  const now = Date.now();
  if (now - lastLog < 60_000) return;
  lastLog = now;
  logServerError("cache: Redis unavailable, using memory", error);
}

function memorySet(key: string, value: string, ttlMs: number, memoryMaxTtlMs = MEMORY_MAX_TTL_MS) {
  if (memory.size >= MAX_MEMORY_ENTRIES && !memory.has(key)) {
    const now = Date.now();
    for (const [k, entry] of memory) if (entry.expiresAt <= now) memory.delete(k);
    for (const k of memory.keys()) {
      if (memory.size < MAX_MEMORY_ENTRIES) break;
      memory.delete(k); // oldest first (Map keeps insertion order)
    }
  }
  memory.delete(key);
  memory.set(key, { value, expiresAt: Date.now() + Math.min(ttlMs, memoryMaxTtlMs) });
}

function memoryGet(key: string): string | undefined {
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return entry.value;
}

/** Which backend serves right now (observability, tests). */
export function cacheBackend(): "redis" | "memory" {
  return getRedis() ? "redis" : "memory";
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  let raw: string | null | undefined;
  const redis = getRedis();
  if (redis) {
    try {
      raw = await redis.get(PREFIX + key);
    } catch (error) {
      reportRedisFailure(error);
      raw = memoryGet(key);
    }
  } else {
    raw = memoryGet(key);
  }
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * `memoryMaxTtlMs` raises the in-process ceiling for one entry. Only for data
 * that can never change (closed business dates); everything else keeps the
 * 10 s default.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlMs: number,
  memoryMaxTtlMs?: number,
): Promise<void> {
  if (ttlMs <= 0) return;
  const raw = JSON.stringify(value);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(PREFIX + key, raw, "PX", Math.ceil(ttlMs));
      return;
    } catch (error) {
      reportRedisFailure(error);
    }
  }
  memorySet(key, raw, ttlMs, memoryMaxTtlMs);
}

/** Deletes keys from both backends (a Redis outage may have written to memory). */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const key of keys) memory.delete(key);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(...keys.map((key) => PREFIX + key));
  } catch (error) {
    reportRedisFailure(error);
  }
}

/** Deletes every key starting with `prefix` from both backends. */
export async function cacheDelPrefix(prefix: string): Promise<void> {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
  const redis = getRedis();
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${PREFIX}${prefix}*`, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) await redis.unlink(...keys);
    } while (cursor !== "0");
  } catch (error) {
    reportRedisFailure(error);
  }
}

/** Test helper: empties the memory cache. */
export function clearMemoryCache(): void {
  memory.clear();
}

// --- stale-while-revalidate with single flight ---------------------------------------------

interface Envelope<T> {
  v: T;
  freshUntil: number;
}
const inFlight = new Map<string, Promise<unknown>>();

/** Runs `loader` once per key at a time; concurrent callers share the promise. */
export function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = loader().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Stale-while-revalidate. A fresh entry (younger than `ttlMs`) is returned as is;
 * an entry past `ttlMs` but within `staleMs` more is returned immediately while
 * one background refresh runs; a missing entry is loaded once (single flight)
 * and awaited. A failing background refresh keeps the stale value.
 */
export interface SwrOptions<T> {
  /** In-process TTL ceiling for this entry (see `cacheSet`). */
  memoryMaxTtlMs?: number;
  /** Return false to hand the value to the caller without storing it. */
  shouldCache?: (value: T) => boolean;
}

export async function swr<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  staleMs = ttlMs * 2,
  options: SwrOptions<T> = {},
): Promise<T> {
  const load = () =>
    singleFlight(key, async () => {
      const value = await loader();
      const envelope: Envelope<T> = { v: value, freshUntil: Date.now() + ttlMs };
      if (options.shouldCache && !options.shouldCache(value)) return value;
      await cacheSet(key, envelope, ttlMs + staleMs, options.memoryMaxTtlMs);
      return value;
    });
  const cached = await cacheGet<Envelope<T>>(key);
  if (!cached) return load();
  if (cached.freshUntil > Date.now()) return cached.v;
  void load().catch((error: unknown) => logServerError(`cache refresh ${key}`, error));
  return cached.v;
}
