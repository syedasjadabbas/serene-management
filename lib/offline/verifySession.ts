import { claimSession, clearOfflineData, reconcileSnapshots } from "./db";

/**
 * Before the offline view shows any snapshot while the network is up, the
 * server confirms the session that recorded it (docs/OFFLINE_ARCHITECTURE.md
 * §J). The snapshot belongs to the last user who signed in on this browser;
 * without this check, anyone at a shared front-desk PC could open /offline
 * after that user's session ended (closed browser, expiry, revocation,
 * disabled account) and read the guest lists for up to 24 h.
 *
 * - `valid`: the session (or one refreshed from the refresh cookie) is live;
 *   the stored data is reconciled with the live access before it is shown.
 * - `ended`: the server says there is no session: everything is wiped.
 * - `unreachable`: no answer, or a server error: the device is effectively
 *   offline, which is what the offline view is for; the snapshot is shown.
 */
export type SessionCheck =
  { state: "valid"; me: MeSummary } | { state: "ended" } | { state: "unreachable" };

export interface MeSummary {
  user: { id: string; displayName: string; isSuperAdmin: boolean };
  properties: { id: string; permissions: readonly string[] }[];
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function checkSession(fetcher: Fetcher = fetch): Promise<SessionCheck> {
  const me = () => fetcher("/api/v1/me", { credentials: "include", cache: "no-store" });
  try {
    let response = await me();
    if (response.status === 401) {
      const refreshed = await fetcher("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (refreshed.status === 401 || refreshed.status === 403) return { state: "ended" };
      if (!refreshed.ok) return { state: "unreachable" };
      response = await me();
    }
    if (response.status === 401 || response.status === 403) return { state: "ended" };
    if (!response.ok) return { state: "unreachable" };
    const body = (await response.json()) as { data?: MeSummary };
    return body.data?.user?.id ? { state: "valid", me: body.data } : { state: "unreachable" };
  } catch {
    return { state: "unreachable" };
  }
}

/** Applies a check to the offline store: wipe, reconcile, or leave as is. */
export async function applySessionCheck(check: SessionCheck): Promise<void> {
  if (check.state === "ended") {
    await clearOfflineData();
  } else if (check.state === "valid") {
    // A different user signing in on this browser wipes the previous user's data.
    await claimSession({ id: check.me.user.id, displayName: check.me.user.displayName });
    await reconcileSnapshots({
      userId: check.me.user.id,
      isSuperAdmin: check.me.user.isSuperAdmin,
      properties: check.me.properties,
    });
  }
}
