"use client";

import { useProperty } from "@/hooks/useProperty";
import { useTopicLive } from "@/lib/realtime/status.store";
import { LIVE_SAFETY_REFETCH_MS, type RealtimeTopic } from "@/lib/realtime/topics";

/**
 * Polling interval for a query of the current property: the screen's own
 * interval while live updates are unavailable, a rare safety refetch while
 * the topic arrives live (changes then refetch it at once,
 * docs/SCALABILITY.md §31).
 */
export function useLivePolling(topic: RealtimeTopic, intervalMs: number): number {
  const property = useProperty();
  return useTopicLive(property.id, topic) ? LIVE_SAFETY_REFETCH_MS : intervalMs;
}
