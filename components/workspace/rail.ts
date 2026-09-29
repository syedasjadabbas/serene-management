"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Collapsed/expanded preference of the navigation rail (lg and up). It is
 * a per-viewer convenience, so it lives in localStorage (guarded: private
 * windows and blocked storage fall back to memory) and syncs across tabs.
 * The server always renders the expanded rail.
 */
const KEY = "sm:rail-collapsed";
const listeners = new Set<() => void>();
let memory = false;

function read(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? memory : stored === "1";
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setRailCollapsed(collapsed: boolean) {
  memory = collapsed;
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // Storage unavailable: the in-memory value still applies for this page.
  }
  for (const listener of listeners) listener();
}

export function useRailCollapsedPreference(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Whether the navigation is rendered inside the collapsed rail (false in the drawer). */
export const RailCollapsedContext = createContext(false);
export const useRailCollapsed = () => useContext(RailCollapsedContext);
