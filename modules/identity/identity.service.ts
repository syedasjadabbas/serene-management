import "server-only";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from "@/lib/auth/tokens";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { serverEnv } from "@/lib/env";
import { auditActor, type RequestMeta, type SessionContext } from "@/lib/http/context";
import { AppError, notFound } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  createSession,
  findActiveSessions,
  findSessionByPreviousHash,
  findSessionByRefreshHash,
  findSessionOwner,
  findUserForLogin,
  incrementFailedLogins,
  recordSuccessfulLogin,
  revokeAllUserSessions,
  revokeSession,
  rotateRefreshToken,
  setLockedUntil,
} from "./identity.repository";
import type { LoginInput } from "./identity.schema";
import type { LoginResult, SessionView } from "./identity.types";

/** Account lockout (docs/ARCHITECTURE.md §9): every 5th consecutive failure locks, doubling up to 24 h. */
export const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_BASE_MS = 15 * 60_000;
const LOCKOUT_MAX_MS = 24 * 60 * 60_000;
/** Two tabs refreshing with the same token within this window is a race, not theft. */
const REFRESH_RACE_GRACE_MS = 20_000;

/** One message for every login failure, so responses never reveal whether an account exists or is locked. */
const INVALID_CREDENTIALS = "Invalid email or password.";
const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

export interface IssuedTokens {
  accessToken: string;
  accessTtlSeconds: number;
  /** Omitted when only the access token was re-issued (refresh race). */
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

export function lockoutDurationMs(failedCount: number): number | null {
  if (failedCount < LOCKOUT_THRESHOLD || failedCount % LOCKOUT_THRESHOLD !== 0) return null;
  const step = failedCount / LOCKOUT_THRESHOLD - 1;
  return Math.min(LOCKOUT_BASE_MS * 2 ** step, LOCKOUT_MAX_MS);
}

export async function login(
  meta: RequestMeta,
  input: LoginInput,
  now: Date = new Date(),
): Promise<{ result: LoginResult; tokens: IssuedTokens }> {
  const user = await findUserForLogin(prisma, input.email);

  if (!user || !user.passwordHash) {
    await verifyAgainstDummy(input.password);
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  // Verify before checking state so every path costs one argon2 verification.
  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  const actor = {
    organizationId: user.organizationId,
    userId: user.id,
    actorType: "USER" as const,
    requestId: meta.requestId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };

  const blockedReason =
    user.status !== "ACTIVE"
      ? `status_${user.status.toLowerCase()}`
      : user.organization.status !== "ACTIVE"
        ? "organization_inactive"
        : user.lockedUntil && user.lockedUntil > now
          ? "locked"
          : null;

  if (blockedReason) {
    await runInTransaction((tx) =>
      recordAudit(tx, actor, {
        action: "auth.login_rejected",
        resourceType: "User",
        resourceId: user.id,
        after: { reason: blockedReason },
      }),
    );
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  if (!passwordOk) {
    await runInTransaction(async (tx) => {
      const { failedLoginCount } = await incrementFailedLogins(tx, user.id);
      await recordAudit(tx, actor, {
        action: "auth.login_failed",
        resourceType: "User",
        resourceId: user.id,
        after: { failedLoginCount },
      });
      const lockMs = lockoutDurationMs(failedLoginCount);
      if (lockMs !== null) {
        const lockedUntil = new Date(now.getTime() + lockMs);
        await setLockedUntil(tx, user.id, lockedUntil);
        await recordAudit(tx, actor, {
          action: "auth.account_locked",
          resourceType: "User",
          resourceId: user.id,
          risk: "HIGH",
          after: { failedLoginCount, lockedUntil: lockedUntil.toISOString() },
        });
      }
    });
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const refreshToken = generateOpaqueToken();
  const session = await runInTransaction(async (tx) => {
    await recordSuccessfulLogin(tx, user.id, now);
    const created = await createSession(tx, {
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: refreshTokenExpiry(now),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await recordAudit(tx, actor, {
      action: "auth.login",
      resourceType: "AuthSession",
      resourceId: created.id,
    });
    return created;
  });

  return {
    result: { user: { id: user.id, displayName: user.displayName, email: user.email } },
    tokens: {
      accessToken: await signAccessToken({
        userId: user.id,
        organizationId: user.organizationId,
        sessionId: session.id,
      }),
      accessTtlSeconds: serverEnv().AUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt: session.expiresAt,
    },
  };
}

/**
 * Refresh-token rotation with reuse detection. Presenting a token that was
 * already rotated away (outside the short race window) means it was copied:
 * the whole session is revoked and the event audited as HIGH risk.
 */
export async function refresh(
  meta: RequestMeta,
  presentedToken: string | undefined,
  now: Date = new Date(),
): Promise<IssuedTokens> {
  if (!presentedToken) throw new AppError("UNAUTHENTICATED", SESSION_EXPIRED);
  const presentedHash = hashOpaqueToken(presentedToken);
  const nextToken = generateOpaqueToken();

  const outcome = await runInTransaction(async (tx) => {
    const current = await findSessionByRefreshHash(tx, presentedHash);
    if (current) {
      if (!isUsable(current, now)) return { kind: "expired" as const };
      const rotated = await rotateOrNull(
        tx,
        current.id,
        presentedHash,
        hashOpaqueToken(nextToken),
        now,
      );
      if (rotated) return { kind: "rotated" as const, session: current };
      // Lost a concurrent rotation: fall through to the previous-token check.
    }

    const previous = await findSessionByPreviousHash(tx, presentedHash);
    if (!previous || !isUsable(previous, now)) return { kind: "expired" as const };

    if (now.getTime() - previous.lastUsedAt.getTime() <= REFRESH_RACE_GRACE_MS) {
      return { kind: "race" as const, session: previous };
    }

    await revokeSession(tx, previous.id, "REFRESH_TOKEN_REUSE", now);
    await recordAudit(
      tx,
      {
        organizationId: previous.user.organizationId,
        userId: previous.user.id,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      {
        action: "auth.refresh_token_reuse",
        resourceType: "AuthSession",
        resourceId: previous.id,
        risk: "HIGH",
        after: { revoked: true },
      },
    );
    return { kind: "reuse" as const };
  });

  if (outcome.kind !== "rotated" && outcome.kind !== "race") {
    throw new AppError("UNAUTHENTICATED", SESSION_EXPIRED);
  }

  const accessToken = await signAccessToken({
    userId: outcome.session.user.id,
    organizationId: outcome.session.user.organizationId,
    sessionId: outcome.session.id,
  });
  const accessTtlSeconds = serverEnv().AUTH_ACCESS_TOKEN_TTL_SECONDS;
  return outcome.kind === "rotated"
    ? {
        accessToken,
        accessTtlSeconds,
        refreshToken: nextToken,
        refreshExpiresAt: outcome.session.expiresAt,
      }
    : { accessToken, accessTtlSeconds };
}

/**
 * Revokes the current session. Works with an expired access token (the
 * refresh cookie identifies the session) and is idempotent.
 */
export async function logout(
  meta: RequestMeta,
  tokens: { refreshToken?: string; accessToken?: string },
  now: Date = new Date(),
): Promise<void> {
  const byRefresh = tokens.refreshToken
    ? await findSessionByRefreshHash(prisma, hashOpaqueToken(tokens.refreshToken))
    : null;
  const claims = byRefresh ? null : await verifyAccessToken(tokens.accessToken);
  const sessionId = byRefresh?.id ?? claims?.sessionId;
  if (!sessionId) return;

  await runInTransaction(async (tx) => {
    const owner = byRefresh
      ? { userId: byRefresh.user.id, organizationId: byRefresh.user.organizationId }
      : claims
        ? { userId: claims.userId, organizationId: claims.organizationId }
        : null;
    const { count } = await revokeSession(tx, sessionId, "LOGOUT", now);
    if (count > 0 && owner) {
      await recordAudit(
        tx,
        {
          ...owner,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        { action: "auth.logout", resourceType: "AuthSession", resourceId: sessionId },
      );
    }
  });
}

export async function listSessions(
  ctx: SessionContext,
  now: Date = new Date(),
): Promise<SessionView[]> {
  const rows = await findActiveSessions(prisma, ctx.userId, now);
  return rows.map((row) => ({
    id: row.id,
    current: row.id === ctx.sessionId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  }));
}

/** Signs out one of the caller's own sessions (e.g. a lost device). */
export async function revokeOwnSession(
  ctx: SessionContext,
  sessionId: string,
  now: Date = new Date(),
) {
  await runInTransaction(async (tx) => {
    const owner = await findSessionOwner(tx, sessionId);
    // Another user's session is indistinguishable from a missing one.
    if (!owner || owner.userId !== ctx.userId) throw notFound("Session");
    const { count } = await revokeSession(tx, sessionId, "USER_REVOKED", now);
    if (count > 0) {
      await recordAudit(tx, auditActor(ctx), {
        action: "auth.session_revoke",
        resourceType: "AuthSession",
        resourceId: sessionId,
      });
    }
  });
  return { revoked: true, current: sessionId === ctx.sessionId };
}

/** Used by administration (disable user, password reset): signs the user out everywhere. */
export async function revokeAllSessionsForUser(
  tx: Tx,
  userId: string,
  reason: string,
  now: Date = new Date(),
) {
  const { count } = await revokeAllUserSessions(tx, userId, reason, now);
  return count;
}

function isUsable(
  session: {
    revokedAt: Date | null;
    expiresAt: Date;
    user: { status: string; organization: { status: string } };
  },
  now: Date,
) {
  return (
    !session.revokedAt &&
    session.expiresAt > now &&
    session.user.status === "ACTIVE" &&
    session.user.organization.status === "ACTIVE"
  );
}

async function rotateOrNull(
  tx: Tx,
  sessionId: string,
  presentedHash: string,
  nextHash: string,
  now: Date,
) {
  const { count } = await rotateRefreshToken(tx, sessionId, presentedHash, nextHash, now);
  return count === 1;
}
