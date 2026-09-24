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

export function incrementFailedLogins(tx: Tx, userId: string) {
  return tx.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
}

export function setLockedUntil(tx: Tx, userId: string, lockedUntil: Date) {
  return tx.user.update({ where: { id: userId }, data: { lockedUntil }, select: { id: true } });
}

export function recordSuccessfulLogin(tx: Tx, userId: string, at: Date) {
  return tx.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    select: { id: true },
  });
}

export function createSession(
  tx: Tx,
  data: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  },
) {
  return tx.authSession.create({ data, select: { id: true, expiresAt: true } });
}

const sessionForRefresh = {
  id: true,
  revokedAt: true,
  expiresAt: true,
  lastUsedAt: true,
  user: {
    select: {
      id: true,
      organizationId: true,
      status: true,
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

export function revokeAllUserSessions(tx: Tx, userId: string, reason: string, at: Date) {
  return tx.authSession.updateMany({
    where: { userId, revokedAt: null },
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
