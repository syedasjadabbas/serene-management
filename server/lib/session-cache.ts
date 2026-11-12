import { serverEnv } from "@/config/env";
import { cacheDel, cacheDelPrefix, cacheGet, cacheSet } from "@/lib/cache";
import { redisConfigured } from "@/lib/redis";
import type { SessionIdentity } from "@/modules/access/access.service";

/**
 * Cache of "this session is active and belongs to this user" (plan §4):
 * the session row's identity facts, keyed by user and session. TTL 30 s with
 * Redis, 10 s in memory (SESSION_CACHE_TTL_MS overrides; 0 switches the cache
 * off). Entries are deleted explicitly after the transaction that revokes a
 * session, changes the password, or changes the user's status or profile, so
 * on the instance that handled the change the effect is immediate; other
 * instances see it within the TTL (immediately with Redis).
 */

const key = (userId: string, sessionId: string) => `sess:${userId}:${sessionId}`;

export function sessionCacheTtlMs(): number {
  return serverEnv().SESSION_CACHE_TTL_MS ?? (redisConfigured() ? 30_000 : 10_000);
}

type Stored = Omit<SessionIdentity, "expiresAt" | "user"> & {
  expiresAt: string;
  user: Omit<SessionIdentity["user"], "avatarUpdatedAt"> & { avatarUpdatedAt: string | null };
};

export async function getCachedSession(
  userId: string,
  sessionId: string,
): Promise<SessionIdentity | undefined> {
  if (sessionCacheTtlMs() <= 0) return undefined;
  const stored = await cacheGet<Stored>(key(userId, sessionId));
  if (!stored) return undefined;
  return {
    ...stored,
    expiresAt: new Date(stored.expiresAt),
    user: {
      ...stored.user,
      avatarUpdatedAt: stored.user.avatarUpdatedAt ? new Date(stored.user.avatarUpdatedAt) : null,
    },
  };
}

export async function setCachedSession(identity: SessionIdentity): Promise<void> {
  const ttl = sessionCacheTtlMs();
  if (ttl <= 0) return;
  const stored: Stored = {
    ...identity,
    expiresAt: identity.expiresAt.toISOString(),
    user: {
      ...identity.user,
      avatarUpdatedAt: identity.user.avatarUpdatedAt?.toISOString() ?? null,
    },
  };
  await cacheSet(key(identity.user.id, identity.sessionId), stored, ttl);
}

/** Forgets one session (logout, revoke, refresh-token reuse). */
export async function invalidateSession(userId: string, sessionId: string): Promise<void> {
  await cacheDel(key(userId, sessionId));
}

/** Forgets every session of a user (disable, enable, unlock, password change or reset, profile change). */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await cacheDelPrefix(`sess:${userId}:`);
}
