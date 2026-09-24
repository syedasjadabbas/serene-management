import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { serverEnv } from "@/lib/env";

/**
 * Access tokens are short-lived HS256 JWTs identifying the user and the
 * session (`sid`). They carry no permissions: permissions are resolved per
 * request, so role changes and revocations apply immediately.
 */

const ISSUER = "serene-management";
const AUDIENCE = "serene-management-web";

export interface AccessTokenClaims {
  userId: string;
  organizationId: string;
  sessionId: string;
}

function accessKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv().AUTH_ACCESS_TOKEN_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const ttl = serverEnv().AUTH_ACCESS_TOKEN_TTL_SECONDS;
  return new SignJWT({ org: claims.organizationId, sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(accessKey());
}

/** Returns the claims of a valid, unexpired token, or null for anything else. */
export async function verifyAccessToken(
  token: string | undefined,
): Promise<AccessTokenClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, accessKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const { sub, org, sid } = payload;
    if (typeof sub !== "string" || typeof org !== "string" || typeof sid !== "string") return null;
    return { userId: sub, organizationId: org, sessionId: sid };
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}

/** 256-bit opaque token (refresh / password reset). Only its hash is stored. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Keyed hash of an opaque token for storage and lookup (hex, 64 chars). */
export function hashOpaqueToken(token: string): string {
  return createHmac("sha256", serverEnv().AUTH_REFRESH_TOKEN_SECRET).update(token).digest("hex");
}

export function refreshTokenExpiry(from = new Date()): Date {
  return new Date(from.getTime() + serverEnv().AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000);
}
