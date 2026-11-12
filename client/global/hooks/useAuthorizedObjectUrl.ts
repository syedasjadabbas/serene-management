"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, API_ORIGIN } from "@/global/constants/api";
import { authorizedFetch } from "@/global/api/session";

/**
 * Where an image URL from the API points. The server may send an absolute
 * URL, a path from the origin (`/api/v1/me/avatar?v=3`) or a path under the
 * API base (`/me/avatar?v=3`).
 */
export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/api/")) return `${API_ORIGIN}${url}`;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Whether the URL points at the API (and so needs the Bearer header). */
function isApiUrl(url: string): boolean {
  return !/^(data:|blob:)/.test(url) && resolveApiUrl(url).startsWith(API_ORIGIN);
}

/**
 * An `<img>` cannot send the Authorization header, so private API images
 * (the profile picture) are fetched with it and shown from an object URL,
 * revoked when the source changes or the component unmounts. `data:`/`blob:`
 * sources (a photo just picked in the profile dialog) and foreign URLs pass
 * through unchanged. Returns null while loading or when the image is missing
 * (callers show initials).
 */
export function useAuthorizedObjectUrl(src: string | null | undefined): string | null {
  const passthrough = Boolean(src) && !isApiUrl(src!);
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null);

  useEffect(() => {
    if (!src || passthrough) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await authorizedFetch(resolveApiUrl(src), {
          signal: controller.signal,
          headers: { Accept: "image/*" },
        });
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setLoaded({ src, url: objectUrl });
      } catch {
        // Offline or aborted: initials are shown.
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, passthrough]);

  if (!src) return null;
  if (passthrough) return src;
  return loaded?.src === src ? loaded.url : null;
}
