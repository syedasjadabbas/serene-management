"use client";

import { useEffect } from "react";
import { useDispatch, useStore } from "react-redux";
import { useProperty } from "@/hooks/useProperty";
import { baseApi, refreshSession } from "@/lib/api/baseApi";
import type { AppStore } from "@/lib/api/store";
import { type StreamEnd, openEventStream } from "@/lib/realtime/client";
import { useRealtimeStore } from "@/lib/realtime/status.store";
import {
  type RealtimeTopic,
  TOPIC_REFETCH_GAP_MS,
  TOPIC_REFETCH_SPREAD_MS,
} from "@/lib/realtime/topics";

/** Cache tags each topic's screens provide (lib/api/endpoints). */
function tagsFor(topic: RealtimeTopic, propertyId: string) {
  switch (topic) {
    case "frontdesk":
      return [{ type: "Stay" as const, id: `FD-${propertyId}` }];
    case "rooms":
      return [{ type: "RoomStatus" as const, id: `BOARD-${propertyId}` }];
    case "housekeeping":
      return [{ type: "HousekeepingTask" as const, id: `LIST-${propertyId}` }];
    case "businessdate":
      return [{ type: "BusinessDate" as const, id: propertyId }];
  }
}

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** A hidden tab keeps its stream this long, then closes it until it is shown again. */
const HIDDEN_CLOSE_MS = 60_000;
const SEEN_MAX = 200;

/**
 * Live updates of the current property (docs/SCALABILITY.md §31): one stream
 * per tab. A change refetches the affected screens' queries: at once after a
 * quiet period, at most once per topic gap during a burst, and only when the
 * tab is visible (like polling, which paused in hidden tabs). While the
 * stream is not live, the screens poll as they always did.
 */
export function PropertyRealtime() {
  const property = useProperty();
  const dispatch = useDispatch();
  const store = useStore() as AppStore;
  const setStatus = useRealtimeStore((state) => state.set);

  useEffect(() => {
    const propertyId = property.id;
    const url = `/api/v1/properties/${propertyId}/events`;
    let close: (() => void) | null = null;
    let stopped = false;
    let retryMs = RETRY_MIN_MS;
    let retryTimer: number | null = null;
    let hiddenTimer: number | null = null;
    let topics: RealtimeTopic[] = [];
    let connectedAt = 0;
    const lastRefetch = new Map<RealtimeTopic, number>();
    const refetchTimers = new Map<RealtimeTopic, number>();
    const dirty = new Set<RealtimeTopic>();
    const seen: string[] = [];

    const refetch = (topic: RealtimeTopic) => {
      refetchTimers.delete(topic);
      lastRefetch.set(topic, Date.now());
      dispatch(baseApi.util.invalidateTags(tagsFor(topic, propertyId)));
    };
    const schedule = (topic: RealtimeTopic) => {
      if (document.visibilityState === "hidden") {
        dirty.add(topic);
        return;
      }
      if (refetchTimers.has(topic)) return;
      const gap = (lastRefetch.get(topic) ?? 0) + TOPIC_REFETCH_GAP_MS[topic] - Date.now();
      // Spread: the property's screens do not all refetch in the same instant.
      const wait = Math.max(0, gap) + Math.random() * TOPIC_REFETCH_SPREAD_MS[topic];
      refetchTimers.set(
        topic,
        window.setTimeout(() => refetch(topic), wait),
      );
    };
    // Data fetched before `since` may have missed events (before the stream
    // was open, or while notifications were down): refetch those topics. A
    // fetch already running since then (e.g. RTK's own refetch when the
    // browser comes back online) counts as fresh, so nothing is fetched twice.
    const reconcile = (since: number) => {
      const state = store.getState();
      for (const topic of topics) {
        const stale = baseApi.util
          .selectInvalidatedBy(state, tagsFor(topic, propertyId))
          .some(({ queryCacheKey }) => {
            const entry = state.api.queries[queryCacheKey];
            if (!entry) return false;
            if (entry.status === "pending" && (entry.startedTimeStamp ?? 0) >= since - 1_000) {
              return false;
            }
            return (entry.fulfilledTimeStamp ?? 0) < since;
          });
        if (stale) schedule(topic);
      }
    };

    const connect = () => {
      if (stopped || close) return;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (!navigator.onLine) return; // resumed by the "online" event
      connectedAt = Date.now();
      setStatus(propertyId, "connecting");
      close = openEventStream(url, {
        ready(data) {
          topics = data.topics;
          retryMs = RETRY_MIN_MS;
          setStatus(propertyId, data.live ? "live" : "connecting", topics);
          if (data.live) reconcile(connectedAt);
        },
        serverState(live) {
          setStatus(propertyId, live ? "live" : "connecting", topics);
          if (live) reconcile(Date.now());
        },
        change({ topics: changed, tx }) {
          for (const topic of changed) {
            const key = `${tx}:${topic}`;
            if (seen.includes(key)) continue; // the same transaction, already applied
            seen.push(key);
            if (seen.length > SEEN_MAX) seen.shift();
            schedule(topic);
          }
        },
        end(reason: StreamEnd) {
          close = null;
          setStatus(
            propertyId,
            reason === "forbidden" || reason === "disabled" ? "off" : "connecting",
          );
          if (stopped || reason === "forbidden" || reason === "disabled") return;
          if (reason === "reauth") {
            connect();
          } else if (reason === "unauthenticated") {
            // The API refreshes the session the same way; without a session
            // the page's own requests send the user to sign in.
            void refreshSession().then((ok) => (ok ? connect() : setStatus(propertyId, "off")));
          } else {
            const delay = Math.round(retryMs * (0.75 + Math.random() * 0.5));
            retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              connect();
            }, delay);
          }
        },
      });
    };
    const disconnect = () => {
      close?.();
      close = null;
      setStatus(propertyId, "connecting");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer ??= window.setTimeout(() => {
          hiddenTimer = null;
          disconnect();
        }, HIDDEN_CLOSE_MS);
        return;
      }
      if (hiddenTimer !== null) {
        window.clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      for (const topic of dirty) schedule(topic);
      dirty.clear();
      connect();
    };
    const onOnline = () => connect();
    const onOffline = () => disconnect();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      for (const timer of refetchTimers.values()) window.clearTimeout(timer);
      close?.();
      setStatus(propertyId, "off");
    };
  }, [property.id, dispatch, store, setStatus]);

  return null;
}
