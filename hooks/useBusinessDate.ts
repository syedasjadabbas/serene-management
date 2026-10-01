"use client";

import { useEffect, useState } from "react";
import { useBusinessDateQuery } from "@/lib/api/endpoints/properties.api";
import { useTopicLive } from "@/lib/realtime/status.store";
import { LIVE_SAFETY_REFETCH_MS } from "@/lib/realtime/topics";
import {
  advancePropertyTime,
  msUntilAfterLocalMidnight,
} from "@/modules/business-date/business-date.policy";
import { useProperty } from "./useProperty";

/**
 * The hotel business date of the current property, from the server. Never
 * derive it from the browser clock. Without live updates it is refreshed
 * every minute. With them (docs/SCALABILITY.md §31) it changes only when the
 * night audit runs (an event refetches it) or at the property's midnight
 * ("awaiting audit"): `rollover` refetches it just after that midnight.
 */
export function useBusinessDate(options: { rollover?: boolean } = {}) {
  const property = useProperty();
  const live = useTopicLive(property.id, "businessdate");
  // Paused while the tab is hidden or unfocused, refreshed on return (B10).
  const query = useBusinessDateQuery(property.id, {
    pollingInterval: live ? LIVE_SAFETY_REFETCH_MS : 60_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const { data, fulfilledTimeStamp, refetch } = query;
  const rollover = options.rollover === true && live;
  useEffect(() => {
    if (!rollover || !data || !fulfilledTimeStamp) return;
    const wait = msUntilAfterLocalMidnight(data.propertyLocalTime, Date.now() - fulfilledTimeStamp);
    const timer = window.setTimeout(() => void refetch(), wait);
    return () => window.clearTimeout(timer);
  }, [rollover, data, fulfilledTimeStamp, refetch]);
  return query;
}

/**
 * The property's local date and time, advancing every minute from the last
 * server value (no request per minute while live updates are on).
 */
export function usePropertyClock(
  view: { propertyLocalDate: string; propertyLocalTime: string } | undefined,
  fulfilledTimeStamp: number | undefined,
): { date: string; time: string } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Re-render often enough that the shown minute is never more than 15 s late.
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!view || !fulfilledTimeStamp) return null;
  return advancePropertyTime(
    view.propertyLocalDate,
    view.propertyLocalTime,
    Math.max(0, now - fulfilledTimeStamp),
  );
}
