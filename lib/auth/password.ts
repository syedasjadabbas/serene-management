import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing: argon2id with OWASP-recommended parameters
 * (m = 19 MiB, t = 2, p = 1). @node-rs/argon2 defaults to argon2id.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hash: treat as a failed verification, never as an error path
    // that could reveal account state.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same CPU time as a real verification. Used when the account does
 * not exist or has no password, so response timing does not reveal which
 * emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("serene-timing-equalizer-not-a-real-password");
  await verifyPassword(await dummyHash, password);
  return false;
}
