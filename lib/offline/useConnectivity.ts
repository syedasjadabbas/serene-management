"use client";

import { useCallback, useEffect, useState } from "react";

/** Liveness probe: no database, no session, never cached (app/api/health/live). */
const PROBE_URL = "/api/health/live";
const PROBE_TIMEOUT_MS = 5_000;
/** Re-probe cadence: often while offline (to notice the return), rarely while online. */
const OFFLINE_PROBE_MS = 15_000;
const ONLINE_PROBE_MS = 60_000;
/** After the browser reports "online" the link is often not usable yet: re-probe quickly. */
const RECONNECT_PROBES_MS = [1_000, 3_000, 6_000];

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(PROBE_URL, { cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Whether the server is reachable. `navigator.onLine` alone is not enough
 * (it says "online" on a LAN whose internet link is down), so "online" is
 * confirmed with a probe; "offline" from the browser is trusted at once.
 * Probes run only while the page is visible. `null` until the first check.
 */
export function useConnectivity() {
  const [online, setOnline] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    if (!navigator.onLine) {
      setOnline(false);
      return false;
    }
    const reachable = await probe();
    setOnline(reachable);
    return reachable;
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let current: boolean | null = null;
    let stopped = false;
    let quick: number[] = [];

    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      const next = current === false ? (quick.shift() ?? OFFLINE_PROBE_MS) : ONLINE_PROBE_MS;
      timer = window.setTimeout(tick, next);
    };
    const tick = async () => {
      current = await check();
      if (current) quick = [];
      schedule();
    };
    const reconnect = () => {
      quick = [...RECONNECT_PROBES_MS];
      void tick();
    };
    const goOffline = () => {
      current = false;
      quick = [];
      setOnline(false);
      schedule();
    };

    void tick();
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [check]);

  return { online, recheck: check };
}
