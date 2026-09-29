"use client";

import { useEffect, useState } from "react";
import {
  OFFLINE_CHANNEL,
  type OfflineSessionMeta,
  listQueue,
  listSnapshots,
  readSessionMeta,
} from "./db";
import type { OfflineSnapshot, QueuedOperation } from "./policy";

export interface OfflineStoreState {
  loaded: boolean;
  session: OfflineSessionMeta | null;
  /** The session owner's snapshots only. */
  snapshots: OfflineSnapshot[];
  queue: QueuedOperation[];
}

const EMPTY: OfflineStoreState = { loaded: false, session: null, snapshots: [], queue: [] };

async function load(): Promise<OfflineStoreState> {
  const session = (await readSessionMeta()) ?? null;
  if (!session) return { loaded: true, session: null, snapshots: [], queue: [] };
  const [snapshots, queue] = await Promise.all([listSnapshots(), listQueue(session.userId)]);
  return {
    loaded: true,
    session,
    snapshots: snapshots.filter((s) => s.userId === session.userId),
    queue,
  };
}

/**
 * The offline store as React state, refreshed whenever this or another tab
 * writes to it (BroadcastChannel) — e.g. sign-out in one tab empties the
 * offline view in every other tab.
 */
export function useOfflineStore(): OfflineStoreState {
  const [state, setState] = useState<OfflineStoreState>(EMPTY);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void load().then((next) => {
        if (active) setState(next);
      });
    refresh();
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(OFFLINE_CHANNEL);
    channel?.addEventListener("message", refresh);
    window.addEventListener(OFFLINE_CHANNEL, refresh);
    return () => {
      active = false;
      channel?.close();
      window.removeEventListener(OFFLINE_CHANNEL, refresh);
    };
  }, []);

  return state;
}

/** Queue counts for the indicator (all zero until phase 2 enqueues anything). */
export function queueCounts(queue: QueuedOperation[], propertyId?: string) {
  const scoped = propertyId ? queue.filter((op) => op.propertyId === propertyId) : queue;
  return {
    waiting: scoped.filter((op) => op.status === "pending" || op.status === "failed").length,
    syncing: scoped.filter((op) => op.status === "syncing").length,
    attention: scoped.filter((op) => op.status === "conflict" || op.status === "rejected").length,
  };
}
