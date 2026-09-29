"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** How long a finished bar stays before it resets (its fade runs meanwhile). */
const SETTLE_MS = 450;
/** A navigation that never lands (cancelled, failed) stops showing progress. */
const GIVE_UP_MS = 12_000;

/**
 * Slim brand-green bar along the top edge while a route loads. It starts
 * when the user follows an internal link to another page (plain left
 * click, no modifier, same tab) and completes as soon as the pathname
 * changes, so it is only visible during a real transition. The bar is
 * decorative: route loading states carry the accessible status.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  // The pathname the pending navigation started from. While it equals the
  // current pathname the target is still loading; once they differ the
  // target has rendered and the bar completes.
  const [startedOn, setStartedOn] = useState<string | null>(null);
  const state = startedOn === null ? "idle" : startedOn === pathname ? "loading" : "done";

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      setStartedOn(window.location.pathname);
    }
    // Capture phase: next/link cancels the native click before it bubbles.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(
      () => setStartedOn(null),
      state === "done" ? SETTLE_MS : GIVE_UP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-(--z-skip) h-0.5 print:hidden"
    >
      <div data-state={state} className="sm-nav-progress h-full bg-brand" />
    </div>
  );
}
