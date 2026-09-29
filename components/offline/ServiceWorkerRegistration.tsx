"use client";

import { useEffect } from "react";

/** The service worker (public/sw.js) runs in production builds only. */
const ENABLED = process.env.NODE_ENV === "production";

/**
 * Registers the service worker that serves the offline shell when a
 * navigation fails, and asks it to refresh that shell after an online load.
 * Browsers without service workers simply have no offline shell.
 *
 * Production only: under `next dev` the dev runtime (HMR, unhashed chunks)
 * cannot run from a cached shell, and a worker would get in the way of
 * development. In development any worker registered earlier is removed with
 * its caches, so the dev server always serves the page itself.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (!ENABLED) {
      void unregisterAll();
      return;
    }
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (!cancelled && navigator.onLine) registration.active?.postMessage("refresh-shell");
      })
      .catch(() => {
        // Blocked (policy, private mode): the app works online without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

async function unregisterAll() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith("/sw.js"))
        .map((r) => r.unregister()),
    );
    for (const key of await caches.keys()) {
      if (key.startsWith("serene-")) await caches.delete(key);
    }
  } catch {
    // Nothing registered, or storage blocked: nothing to clean up.
  }
}
