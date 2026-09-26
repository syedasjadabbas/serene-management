import "server-only";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
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
import { consumeRateLimit, type RateLimitRule } from "@/lib/http/rate-limit";
import {
  claimResetToken,
  createSession,
  findActiveSessions,
  findResetToken,
  findSessionByPreviousHash,
  findSessionByRefreshHash,
  findSessionOwner,
  findUserForLogin,
  insertPasswordResetToken,
  invalidateResetTokens,
  lockUserLoginState,
  recordSuccessfulLogin,
  revokeAllUserSessions,
  revokeSession,
  rotateRefreshToken,
  setLoginFailureState,
  setPassword,
} from "./identity.repository";
import type {
  ChangePasswordInput,
  CompletePasswordResetInput,
  LoginInput,
} from "./identity.schema";
import type { LoginResult, SessionView } from "./identity.types";

/**
 * Account lockout (docs/ARCHITECTURE.md §9, D45): every 5th consecutive
 * failure locks the account, 15 min doubling up to 1 h. A lock that ended
 * more than a day ago starts the count again, so an attacker who only knows
 * an email address can delay a user's sign-in but never lock them out for
 * long; an administrator can always unlock.
 */
export const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_BASE_MS = 15 * 60_000;
export const LOCKOUT_MAX_MS = 60 * 60_000;
const LOCKOUT_DECAY_MS = 24 * 60 * 60_000;
/** Per-account attempt budget, checked before any password hashing (H5). */
export const LOGIN_ACCOUNT_LIMIT: RateLimitRule = {
  name: "auth.login.account",
  limit: 10,
  windowMs: 15 * 60_000,
};
/** Two tabs refreshing with the same token within this window is a race, not theft. */
const REFRESH_RACE_GRACE_MS = 20_000;

/** One message for every login failure, so responses never reveal whether an account exists or is locked. */
const INVALID_CREDENTIALS = "Invalid email or password.";
const SESSION_EXPIRED = "Your session has expired. Please sign in again.";
const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Please wait and try again.";

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
  return Math.min(LOCKOUT_BASE_MS * 2 ** Math.min(step, 16), LOCKOUT_MAX_MS);
}

/** Failure count to continue from: a lock that ended long ago no longer counts. */
export function effectiveFailureCount(
  failedCount: number,
  lockedUntil: Date | null,
  now: Date,
): number {
  if (lockedUntil && lockedUntil.getTime() + LOCKOUT_DECAY_MS <= now.getTime()) return 0;
  return failedCount;
}

type Admission =
  | { kind: "blocked"; reason: string; passwordHash: string | null }
  | { kind: "admitted"; passwordHash: string; failedLoginCount: number; lockedUntil: Date | null };

/**
 * Decides, with the user row locked, whether this attempt may be evaluated
 * (H5). The attempt is counted BEFORE the password is verified: concurrent
 * guesses queue on the row lock and at most LOCKOUT_THRESHOLD of them are
 * admitted before the account locks; a successful sign-in then resets the
 * count. Argon2 itself runs outside the transaction.
 */
async function admitLoginAttempt(userId: string, now: Date): Promise<Admission> {
  return runInTransaction(async (tx) => {
    const row = await lockUserLoginState(tx, userId);
    if (!row || !row.password_hash) {
      return { kind: "blocked", reason: "no_password", passwordHash: null };
    }
    const reason =
      row.status !== "ACTIVE"
        ? `status_${row.status.toLowerCase()}`
        : row.organization_status !== "ACTIVE"
          ? "organization_inactive"
          : row.locked_until && row.locked_until > now
            ? "locked"
            : null;
    if (reason) return { kind: "blocked", reason, passwordHash: row.password_hash };

    const failedLoginCount =
      effectiveFailureCount(row.failed_login_count, row.locked_until, now) + 1;
    const lockMs = lockoutDurationMs(failedLoginCount);
    const lockedUntil = lockMs === null ? null : new Date(now.getTime() + lockMs);
    await setLoginFailureState(tx, userId, { failedLoginCount, lockedUntil });
    return { kind: "admitted", passwordHash: row.password_hash, failedLoginCount, lockedUntil };
  });
}

export async function login(
  meta: RequestMeta,
  input: LoginInput,
  now: Date = new Date(),
): Promise<{ result: LoginResult; tokens: IssuedTokens }> {
  // Cheap per-account brake before any database work or hashing. It applies
  // to unknown emails exactly like known ones, so it reveals nothing.
  const budget = await consumeRateLimit(LOGIN_ACCOUNT_LIMIT, `email:${input.email}`, now.getTime());
  if (!budget.allowed) {
    throw new AppError("RATE_LIMITED", TOO_MANY_ATTEMPTS, {
      retryAfterSeconds: budget.retryAfterSeconds,
    });
  }

  const user = await findUserForLogin(prisma, input.email);
  if (!user || !user.passwordHash) {
    await verifyAgainstDummy(input.password);
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }
  const actor = {
    organizationId: user.organizationId,
    userId: user.id,
    actorType: "USER" as const,
    requestId: meta.requestId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };

  const admission = await admitLoginAttempt(user.id, now);
  // Every path costs one argon2 verification, so timing does not reveal state.
  const passwordOk = admission.passwordHash
    ? await verifyPassword(admission.passwordHash, input.password)
    : await verifyAgainstDummy(input.password);

  if (admission.kind === "blocked") {
    await runInTransaction((tx) =>
      recordAudit(tx, actor, {
        action: "auth.login_rejected",
        resourceType: "User",
        resourceId: user.id,
        after: { reason: admission.reason },
      }),
    );
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  if (!passwordOk) {
    await runInTransaction(async (tx) => {
      await recordAudit(tx, actor, {
        action: "auth.login_failed",
        resourceType: "User",
        resourceId: user.id,
        after: { failedLoginCount: admission.failedLoginCount },
      });
      if (admission.lockedUntil) {
        await recordAudit(tx, actor, {
          action: "auth.account_locked",
          resourceType: "User",
          resourceId: user.id,
          risk: "HIGH",
          after: {
            failedLoginCount: admission.failedLoginCount,
            lockedUntil: admission.lockedUntil.toISOString(),
          },
        });
      }
    });
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const refreshToken = generateOpaqueToken();
  const session = await runInTransaction(async (tx) => {
    // Re-check under the row lock: the user may have been disabled or had
    // the password replaced while argon2 was running.
    const current = await lockUserLoginState(tx, user.id);
    if (
      !current ||
      current.status !== "ACTIVE" ||
      current.organization_status !== "ACTIVE" ||
      current.password_hash !== admission.passwordHash
    ) {
      return null;
    }
    await recordSuccessfulLogin(tx, user.id, now);
    const created = await createSession(tx, {
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: refreshTokenExpiry(now),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      createdAt: now,
    });
    await recordAudit(tx, actor, {
      action: "auth.login",
      resourceType: "AuthSession",
      resourceId: created.id,
    });
    return created;
  });
  if (!session) throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);

  return {
    result: { user: { id: user.id, displayName: user.displayName, email: user.email } },
    tokens: await issueTokens(
      { userId: user.id, organizationId: user.organizationId, sessionId: session.id },
      refreshToken,
      session.expiresAt,
    ),
  };
}

async function issueTokens(
  claims: { userId: string; organizationId: string; sessionId: string },
  refreshToken: string,
  refreshExpiresAt: Date,
): Promise<IssuedTokens> {
  return {
    accessToken: await signAccessToken(claims),
    accessTtlSeconds: serverEnv().AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshExpiresAt,
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

// --- Password lifecycle (H4) --------------------------------------------------------------

/** Reset links expire after 30 minutes and work once. */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Per-user budget for password changes (wrong current passwords included). */
export const PASSWORD_CHANGE_LIMIT: RateLimitRule = {
  name: "auth.password.change",
  limit: 5,
  windowMs: 15 * 60_000,
};
const INVALID_RESET =
  "This reset link is invalid or has expired. Ask an administrator for a new one.";

/**
 * The signed-in user replaces their own password. The current password is
 * verified first; on success EVERY session of the user, the current one
 * included, is revoked and a fresh session is issued to this browser, so
 * tokens copied from any earlier session stop working. Pending reset links
 * are invalidated. Audited HIGH; passwords never reach logs or audit rows.
 */
export async function changePassword(
  ctx: SessionContext,
  input: ChangePasswordInput,
  now: Date = new Date(),
): Promise<IssuedTokens> {
  const budget = await consumeRateLimit(PASSWORD_CHANGE_LIMIT, `user:${ctx.userId}`, now.getTime());
  if (!budget.allowed) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait and try again.", {
      retryAfterSeconds: budget.retryAfterSeconds,
    });
  }
  const state = await runInTransaction((tx) => lockUserLoginState(tx, ctx.userId));
  if (!state || state.status !== "ACTIVE" || !state.password_hash) {
    throw new AppError("UNAUTHENTICATED", SESSION_EXPIRED);
  }
  if (!(await verifyPassword(state.password_hash, input.currentPassword))) {
    await runInTransaction((tx) =>
      recordAudit(tx, auditActor(ctx), {
        action: "auth.password_change_failed",
        resourceType: "User",
        resourceId: ctx.userId,
      }),
    );
    throw new AppError("VALIDATION_FAILED", "The current password is incorrect", {
      fields: { currentPassword: ["The current password is incorrect"] },
    });
  }
  if (input.newPassword === input.currentPassword) {
    throw new AppError("VALIDATION_FAILED", "Choose a password different from the current one", {
      fields: { newPassword: ["Must differ from the current password"] },
    });
  }
  const passwordHash = await hashPassword(input.newPassword);
  const refreshToken = generateOpaqueToken();

  const session = await runInTransaction(async (tx) => {
    const current = await lockUserLoginState(tx, ctx.userId);
    // Changed or disabled concurrently: the caller must start again.
    if (!current || current.status !== "ACTIVE" || current.password_hash !== state.password_hash) {
      throw new AppError("CONFLICT", "Your password was changed elsewhere. Please sign in again.");
    }
    await setPassword(tx, ctx.userId, passwordHash, now);
    const { count: sessionsRevoked } = await revokeAllUserSessions(
      tx,
      ctx.userId,
      "PASSWORD_CHANGED",
      now,
    );
    await invalidateResetTokens(tx, ctx.userId, now);
    const created = await createSession(tx, {
      userId: ctx.userId,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: refreshTokenExpiry(now),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      createdAt: now,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "auth.password_change",
      resourceType: "User",
      resourceId: ctx.userId,
      risk: "HIGH",
      after: { sessionsRevoked, newSessionId: created.id },
    });
    return created;
  });

  return issueTokens(
    { userId: ctx.userId, organizationId: ctx.organizationId, sessionId: session.id },
    refreshToken,
    session.expiresAt,
  );
}

/**
 * Administrator-issued reset (H4), inside the caller's transaction after the
 * users service has authorized it. The old password stops working at once
 * (the hash is cleared), every session is revoked, earlier links are
 * invalidated, and a single-use token valid for 30 minutes is created. Only
 * its keyed hash is stored; the raw token is returned once to the caller.
 */
export async function issuePasswordResetInTx(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; tokenId: string; expiresAt: Date; sessionsRevoked: number }> {
  const token = generateOpaqueToken();
  await invalidateResetTokens(tx, userId, now);
  const created = await insertPasswordResetToken(tx, {
    userId,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    createdAt: now,
  });
  await setPassword(tx, userId, null, now);
  const { count: sessionsRevoked } = await revokeAllUserSessions(
    tx,
    userId,
    "PASSWORD_RESET_ISSUED",
    now,
  );
  return { token, tokenId: created.id, expiresAt: created.expiresAt, sessionsRevoked };
}

/**
 * Sets a new password with a reset token. The token is claimed with a
 * compare-and-set, so it works exactly once even under concurrent use. All
 * sessions are revoked; the user then signs in normally. Invalid, used and
 * expired tokens all get the same answer.
 */
export async function completePasswordReset(
  meta: RequestMeta,
  input: CompletePasswordResetInput,
  now: Date = new Date(),
): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const found = await findResetToken(prisma, tokenHash);
  if (!found || found.usedAt || found.expiresAt <= now) {
    throw new AppError("VALIDATION_FAILED", INVALID_RESET, { reason: "RESET_TOKEN_INVALID" });
  }
  const passwordHash = await hashPassword(input.newPassword);

  await runInTransaction(async (tx) => {
    const { count } = await claimResetToken(tx, found.id, now);
    const user = count === 1 ? await lockUserLoginState(tx, found.userId) : null;
    if (
      !user ||
      (user.status !== "ACTIVE" && user.status !== "LOCKED") ||
      user.organization_status !== "ACTIVE"
    ) {
      throw new AppError("VALIDATION_FAILED", INVALID_RESET, { reason: "RESET_TOKEN_INVALID" });
    }
    await setPassword(tx, user.id, passwordHash, now);
    await invalidateResetTokens(tx, user.id, now);
    const { count: sessionsRevoked } = await revokeAllUserSessions(
      tx,
      user.id,
      "PASSWORD_RESET",
      now,
    );
    await recordAudit(
      tx,
      {
        organizationId: user.organization_id,
        userId: user.id,
        actorType: "USER",
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      {
        action: "auth.password_reset_complete",
        resourceType: "User",
        resourceId: user.id,
        risk: "HIGH",
        after: { tokenId: found.id, sessionsRevoked },
      },
    );
  });
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
    createdAt: Date;
    user: { status: string; passwordChangedAt: Date | null; organization: { status: string } };
  },
  now: Date,
) {
  return (
    !session.revokedAt &&
    session.expiresAt > now &&
    !sessionPredatesPasswordChange(session.createdAt, session.user.passwordChangedAt) &&
    session.user.status === "ACTIVE" &&
    session.user.organization.status === "ACTIVE"
  );
}

/**
 * A session opened before the current password was set is never valid again
 * (H4), even if a revocation were missed: password change and reset revoke
 * sessions explicitly, and this is the second line of defence.
 */
export function sessionPredatesPasswordChange(
  sessionCreatedAt: Date,
  passwordChangedAt: Date | null,
): boolean {
  return passwordChangedAt !== null && sessionCreatedAt < passwordChangedAt;
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
