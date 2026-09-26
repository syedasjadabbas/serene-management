import "server-only";
import type { Tx } from "@/lib/db/prisma";

export function findUserForLogin(tx: Tx, email: string) {
  return tx.user.findUnique({
    where: { email },
    select: {
      id: true,
      organizationId: true,
      email: true,
      displayName: true,
      passwordHash: true,
      status: true,
      failedLoginCount: true,
      lockedUntil: true,
      organization: { select: { status: true } },
    },
  });
}

export interface LoginStateRow {
  id: string;
  organization_id: string;
  status: string;
  organization_status: string;
  password_hash: string | null;
  password_changed_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
}

/**
 * The user's login state with the row locked until the transaction ends, so
 * concurrent attempts on one account are decided one at a time (H5).
 */
export async function lockUserLoginState(tx: Tx, userId: string): Promise<LoginStateRow | null> {
  const rows = await tx.$queryRaw<LoginStateRow[]>`
    SELECT u."id", u."organization_id", u."status"::text AS "status",
           o."status"::text AS "organization_status", u."password_hash",
           u."password_changed_at", u."failed_login_count", u."locked_until"
    FROM "users" u
    JOIN "organizations" o ON o."id" = u."organization_id"
    WHERE u."id" = ${userId}::uuid
    FOR UPDATE OF u`;
  return rows[0] ?? null;
}

export function setLoginFailureState(
  tx: Tx,
  userId: string,
  data: { failedLoginCount: number; lockedUntil: Date | null },
) {
  return tx.user.update({ where: { id: userId }, data, select: { id: true } });
}

export function recordSuccessfulLogin(tx: Tx, userId: string, at: Date) {
  return tx.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    select: { id: true },
  });
}

/** Replaces the password; every earlier session becomes invalid (createdAt < passwordChangedAt). */
export function setPassword(tx: Tx, userId: string, passwordHash: string | null, at: Date) {
  return tx.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: at, failedLoginCount: 0, lockedUntil: null },
    select: { id: true },
  });
}

export function insertPasswordResetToken(
  tx: Tx,
  data: { userId: string; tokenHash: string; expiresAt: Date; createdAt: Date },
) {
  return tx.passwordResetToken.create({ data, select: { id: true, expiresAt: true } });
}

/** Marks every unused reset token of the user as used (superseded or consumed). */
export function invalidateResetTokens(tx: Tx, userId: string, at: Date) {
  return tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: at },
  });
}

export function findResetToken(tx: Tx, tokenHash: string) {
  return tx.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
}

/** Single use: only the first caller flips `usedAt` (compare-and-set). */
export function claimResetToken(tx: Tx, tokenId: string, at: Date) {
  return tx.passwordResetToken.updateMany({
    where: { id: tokenId, usedAt: null, expiresAt: { gt: at } },
    data: { usedAt: at },
  });
}

/**
 * `createdAt` comes from the application clock, the same clock that sets
 * `users.password_changed_at`, so a session is never judged older than a
 * password change it follows because of database clock skew.
 */
export function createSession(
  tx: Tx,
  data: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
  },
) {
  return tx.authSession.create({
    data: { ...data, lastUsedAt: data.createdAt },
    select: { id: true, expiresAt: true },
  });
}

const sessionForRefresh = {
  id: true,
  revokedAt: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      organizationId: true,
      status: true,
      passwordChangedAt: true,
      organization: { select: { status: true } },
    },
  },
} as const;

export function findSessionByRefreshHash(tx: Tx, refreshTokenHash: string) {
  return tx.authSession.findUnique({ where: { refreshTokenHash }, select: sessionForRefresh });
}

export function findSessionByPreviousHash(tx: Tx, previousTokenHash: string) {
  return tx.authSession.findUnique({ where: { previousTokenHash }, select: sessionForRefresh });
}

/** Compare-and-swap rotation: only succeeds if the presented token is still current. */
export function rotateRefreshToken(
  tx: Tx,
  sessionId: string,
  presentedHash: string,
  nextHash: string,
  at: Date,
) {
  return tx.authSession.updateMany({
    where: { id: sessionId, refreshTokenHash: presentedHash, revokedAt: null },
    data: {
      previousTokenHash: presentedHash,
      refreshTokenHash: nextHash,
      rotationCounter: { increment: 1 },
      lastUsedAt: at,
    },
  });
}

export function revokeSession(tx: Tx, sessionId: string, reason: string, at: Date) {
  return tx.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: at, revokedReason: reason },
  });
}

export function revokeAllUserSessions(
  tx: Tx,
  userId: string,
  reason: string,
  at: Date,
  exceptSessionId: string | null = null,
) {
  return tx.authSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: at, revokedReason: reason },
  });
}

export function findActiveSessions(tx: Tx, userId: string, now: Date) {
  return tx.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastUsedAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
  });
}

export function findSessionOwner(tx: Tx, sessionId: string) {
  return tx.authSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });
}
