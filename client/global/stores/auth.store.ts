import { create } from "zustand";

/**
 * In-memory authentication state (docs/SERVER_SPLIT_PLAN.md §4). The access
 * token lives only here (never in storage); the refresh token is an httpOnly
 * cookie the browser sends to `/auth/refresh`.
 *
 * `booting`        the one refresh attempt on page load has not finished yet
 * `authenticated`  a usable access token is held
 * `anonymous`      no session (never signed in, signed out, or the server ended it)
 */
export type AuthStatus = "booting" | "authenticated" | "anonymous";

/** Why the server ended the session (shown on the login page). */
export interface SessionEnd {
  code: string;
  message: string;
}

interface AuthState {
  accessToken: string | null;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number | null;
  status: AuthStatus;
  /** Set when the server rejected the session; cleared by the next sign-in. */
  endedBy: SessionEnd | null;
  /** True after the user chose to sign out (no `next`/`reason` on the login URL). */
  deliberate: boolean;
  setSession(accessToken: string, expiresInSeconds: number): void;
  clear(endedBy?: SessionEnd | null, options?: { deliberate?: boolean }): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  expiresAt: null,
  status: "booting",
  endedBy: null,
  deliberate: false,
  setSession: (accessToken, expiresInSeconds) =>
    set({
      accessToken,
      expiresAt: Date.now() + Math.max(0, expiresInSeconds) * 1000,
      status: "authenticated",
      endedBy: null,
      deliberate: false,
    }),
  clear: (endedBy = null, options) =>
    set({
      accessToken: null,
      expiresAt: null,
      status: "anonymous",
      endedBy,
      deliberate: options?.deliberate ?? false,
    }),
}));

/** Current access token for code outside React (base query, streams, downloads). */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
