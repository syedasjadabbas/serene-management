"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False while React hydrates server HTML, true afterwards (and on every
 * client-side render). A page inside a Suspense boundary can hydrate after
 * the shell's requests (session, business date) have already started or
 * resolved; hiding that data until hydration ends keeps the first client
 * render identical to the server's, where no query has run.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
