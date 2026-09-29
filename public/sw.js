/* SERENE MANAGEMENT service worker (docs/OFFLINE_ARCHITECTURE.md §L).
 *
 * Deliberately small. It caches ONLY public, user-independent resources:
 *   - the /offline shell page (no server data in it),
 *   - the framework's static assets (/_next/static: JS, CSS, fonts),
 *   - the app icon and manifest.
 * It never caches API responses (/api/*), authenticated pages, RSC payloads
 * or images from /_next/image. Private data lives only in IndexedDB, written
 * by the app itself under user/property keys, never by this worker.
 *
 * Navigations are network-first. When the network fails, the user gets the
 * cached offline shell (redirected to /offline?from=<path>, so the shell
 * knows which property was being opened).
 */

const VERSION = "v1";
const SHELL_CACHE = `serene-shell-${VERSION}`;
const STATIC_CACHE = `serene-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = ["/icon.svg", "/manifest.webmanifest"];
const STATIC_LIMIT = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await cacheShell();
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("serene-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * Pages ask for a fresh shell after loading online (new deploys bring new
 * chunks); at most every SHELL_REFRESH_MS.
 */
const SHELL_REFRESH_MS = 30 * 60 * 1000;
self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data !== "refresh-shell") return;
  event.waitUntil(
    (async () => {
      const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
      const cachedAt = Number(cached?.headers.get("x-serene-cached-at") ?? 0);
      if (Date.now() - cachedAt > SHELL_REFRESH_MS) await cacheShell();
    })(),
  );
});

/**
 * Fetches /offline plus every static asset it references, and replaces the
 * cached shell only when all of them arrived: a half-cached shell would load
 * without its scripts.
 */
async function cacheShell() {
  try {
    const response = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "omit" });
    if (!response.ok || response.redirected) return;
    const html = await response.clone().text();
    const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])];
    const staticCache = await caches.open(STATIC_CACHE);
    await Promise.all(
      assets.map(async (url) => {
        if (await staticCache.match(url)) return;
        const asset = await fetch(url, { credentials: "omit" });
        if (!asset.ok) throw new Error(`asset ${url}`);
        await staticCache.put(url, asset);
      }),
    );
    const headers = new Headers(response.headers);
    // The body is re-wrapped as decoded text: the transfer headers of the
    // original (compressed) response would truncate it.
    for (const name of ["content-length", "content-encoding", "transfer-encoding"]) {
      headers.delete(name);
    }
    headers.set("x-serene-cached-at", String(Date.now()));
    const shell = await caches.open(SHELL_CACHE);
    await shell.put(OFFLINE_URL, new Response(html, { status: 200, statusText: "OK", headers }));
  } catch {
    // Offline or a failed asset: keep the previous shell.
  }
}

async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT))) {
    await cache.delete(request);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touched: API (private data), image optimizer, RSC/prefetch fetches.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/image")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(staticAsset(request));
  }
});

async function navigate(request, url) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (url.pathname === OFFLINE_URL) {
      return shell ?? offlineFallback();
    }
    if (!shell) return offlineFallback();
    const from = `${url.pathname}${url.search}`;
    return Response.redirect(`${OFFLINE_URL}?from=${encodeURIComponent(from)}`, 302);
  }
}

/**
 * Network first (development assets are not content-hashed), falling back
 * to the cache when offline. Only successful same-origin responses are kept.
 */
async function staticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      void trimStatic();
    }
    return response;
  } catch {
    // Not cached: a plain network error for the page, like any failed load.
    return (await cache.match(request)) ?? Response.error();
  }
}

/** Last resort when not even the shell is cached yet: a plain, script-free page. */
function offlineFallback() {
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" +
      "<title>Offline · SERENE MANAGEMENT</title>" +
      "<body style='font-family:system-ui;margin:3rem auto;max-width:32rem;padding:0 1rem;color:#1b1f1d'>" +
      "<h1 style='font-size:1.25rem'>You are offline</h1>" +
      "<p>SERENE MANAGEMENT needs a connection to open this page. Reload when the connection returns.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
