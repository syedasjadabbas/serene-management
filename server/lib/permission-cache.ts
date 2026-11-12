import { serverEnv } from "@/config/env";
import { cacheDel, cacheDelPrefix, cacheGet, cacheSet } from "@/lib/cache";
import { redisConfigured } from "@/lib/redis";
import type { AccessSnapshot } from "@/modules/access/access.service";

/**
 * Cache of a user's effective access: grants by scope and the properties they
 * reach (plan §4). TTL 30 s with Redis, 10 s in memory
 * (PERMISSION_CACHE_TTL_MS overrides; 0 switches it off). Invalidated after
 * role grants and revokes, role-permission changes, user status changes and
 * property changes (`invalidateAllPermissions`).
 */

const key = (userId: string) => `perm:${userId}`;

export function permissionCacheTtlMs(): number {
  return serverEnv().PERMISSION_CACHE_TTL_MS ?? (redisConfigured() ? 30_000 : 10_000);
}

export async function getCachedAccess(userId: string): Promise<AccessSnapshot | undefined> {
  if (permissionCacheTtlMs() <= 0) return undefined;
  return cacheGet<AccessSnapshot>(key(userId));
}

export async function setCachedAccess(userId: string, snapshot: AccessSnapshot): Promise<void> {
  const ttl = permissionCacheTtlMs();
  if (ttl > 0) await cacheSet(key(userId), snapshot, ttl);
}

export async function invalidateUserPermissions(userId: string): Promise<void> {
  await cacheDel(key(userId));
}

/** Role-permission or property changes can affect many users: forget all. */
export async function invalidateAllPermissions(): Promise<void> {
  await cacheDelPrefix("perm:");
}
