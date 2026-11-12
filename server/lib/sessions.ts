import type { AccessTokenClaims } from "@/lib/jwt";
import {
  getCachedAccess,
  invalidateUserPermissions,
  setCachedAccess,
} from "@/lib/permission-cache";
import { getCachedSession, invalidateUserSessions, setCachedSession } from "@/lib/session-cache";
import {
  type AuthedSession,
  type SessionRejection,
  loadAccessSnapshot,
  loadSession,
} from "@/modules/access/access.service";

/**
 * Cached session resolution for the request pipeline (middlewares/auth.ts).
 *
 *  1. session cache hit (identity of an active session)  +  permission cache hit
 *     -> no database access at all;
 *  2. session hit, permissions missing -> one grants query (`loadAccessSnapshot`);
 *  3. session miss -> the full single-statement load (`loadSession`), which
 *     fills both caches.
 *
 * Business dates are never cached; property routes read theirs per request.
 */
export async function resolveSessionCached(
  claims: AccessTokenClaims,
  now: Date = new Date(),
): Promise<{ ok: true; session: AuthedSession } | { ok: false; reason: SessionRejection }> {
  const identity = await getCachedSession(claims.userId, claims.sessionId);
  if (
    identity &&
    identity.expiresAt > now &&
    identity.user.id === claims.userId &&
    identity.user.organizationId === claims.organizationId
  ) {
    let snapshot = await getCachedAccess(claims.userId);
    if (!snapshot) {
      const loaded = await loadAccessSnapshot(claims.userId, claims.organizationId);
      // The user was disabled meanwhile (and nobody invalidated): start over.
      if (!loaded) return fullLoad(claims, now);
      snapshot = loaded;
      await setCachedAccess(claims.userId, loaded);
    }
    return { ok: true, session: { ...identity, ...snapshot } };
  }
  return fullLoad(claims, now);
}

async function fullLoad(claims: AccessTokenClaims, now: Date) {
  const loaded = await loadSession(claims, now);
  if (!loaded.ok) return loaded;
  await Promise.all([
    setCachedSession(loaded.identity),
    setCachedAccess(loaded.identity.user.id, loaded.snapshot),
  ]);
  return {
    ok: true as const,
    session: {
      sessionId: loaded.identity.sessionId,
      user: loaded.identity.user,
      organization: loaded.identity.organization,
      access: loaded.snapshot.access,
      properties: loaded.snapshot.properties,
    },
  };
}

/** Forgets everything cached about a user's sessions and permissions (after the DB commit). */
export async function invalidateUserAuth(userId: string): Promise<void> {
  await Promise.all([invalidateUserSessions(userId), invalidateUserPermissions(userId)]);
}
