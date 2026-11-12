import { AppError } from "@/lib/customError";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "@/lib/auth/cookies";
import { handle } from "@/lib/controller";
import type { AccessTokenData, LoginData } from "@serene/shared/types/api";
import { toMeView } from "@/modules/access/access.service";
import * as service from "./identity.service";

const bearerOf = (header: string | undefined) => /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];

function tokenData(tokens: service.IssuedTokens): AccessTokenData {
  return { accessToken: tokens.accessToken, expiresIn: tokens.accessTtlSeconds };
}

export const login = handle(async (req, res): Promise<LoginData> => {
  const platform = service.parseClientPlatform(req.get("x-client-platform"));
  const { result, tokens } = await service.login(req.meta, req.body, platform);
  if (tokens.refreshToken && tokens.refreshExpiresAt) {
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  }
  return { ...tokenData(tokens), user: result.user };
});

export const refresh = handle(async (req, res): Promise<AccessTokenData> => {
  try {
    const tokens = await service.refresh(req.meta, readRefreshCookie(req.cookies));
    if (tokens.refreshToken && tokens.refreshExpiresAt) {
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    }
    return tokenData(tokens);
  } catch (error) {
    // A dead refresh token must not linger in the browser.
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") clearRefreshCookie(res);
    throw error;
  }
});

/** Idempotent; works even when the access token has already expired. */
export const logout = handle(async (req, res) => {
  await service.logout(req.meta, {
    refreshToken: readRefreshCookie(req.cookies),
    accessToken: bearerOf(req.get("authorization")),
  });
  clearRefreshCookie(res);
  return { loggedOut: true };
});

/** The signed-in user changes their password: every earlier session ends, this client gets a new one. */
export const changePassword = handle(async (req, res) => {
  const platform = service.parseClientPlatform(req.get("x-client-platform"));
  const tokens = await service.changePassword(req.ctx, req.body, platform);
  if (tokens.refreshToken && tokens.refreshExpiresAt) {
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  }
  return { changed: true, ...tokenData(tokens) };
});

/** Sets a new password with a one-time reset token (H4). */
export const completePasswordReset = handle(async (req) => {
  await service.completePasswordReset(req.meta, req.body);
  return { reset: true };
});

export const listSessions = handle((req) => service.listSessions(req.ctx));

export const revokeSession = handle(async (req, res) => {
  const result = await service.revokeOwnSession(req.ctx, req.params.sessionId);
  if (result.current) clearRefreshCookie(res);
  return result;
});

export const me = handle((req) => toMeView(req.auth));

/** The signed-in user edits their own profile (display name); audited. */
export const updateProfile = handle((req) => service.updateOwnProfile(req.ctx, req.body));

/**
 * The signed-in user's own profile picture: the image bytes (type from the
 * stored, signature-checked value; never sniffed or run as a document). The
 * client fetches it with the Authorization header and shows a blob URL.
 */
export const getAvatar = handle(async (req, res) => {
  const avatar = await service.getOwnAvatar(req.ctx.userId);
  res.status(200);
  res.set({
    "content-type": avatar.contentType,
    "content-length": String(avatar.byteSize),
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  res.end(Buffer.from(avatar.data));
});

export const setAvatar = handle((req) => service.setOwnAvatar(req.ctx, req.body));

export const removeAvatar = handle((req) => service.removeOwnAvatar(req.ctx));
