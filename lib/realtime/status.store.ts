import { create } from "zustand";
import type { RealtimeTopic } from "./topics";

/**
 * Live-update state per property (UI state; docs/SCALABILITY.md §31). A
 * screen stops polling a topic only while its property is `live` and the
 * topic is one the stream delivers; in every other state it polls as before.
 */
export type RealtimeStatus = "connecting" | "live" | "off";

interface RealtimeState {
  byProperty: Record<string, { status: RealtimeStatus; topics: RealtimeTopic[] }>;
  set(propertyId: string, status: RealtimeStatus, topics?: RealtimeTopic[]): void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  byProperty: {},
  set: (propertyId, status, topics) =>
    set((state) => ({
      byProperty: {
        ...state.byProperty,
        [propertyId]: { status, topics: topics ?? state.byProperty[propertyId]?.topics ?? [] },
      },
    })),
}));

/** Whether a topic of this property is delivered live right now. */
export function useTopicLive(propertyId: string, topic: RealtimeTopic): boolean {
  return useRealtimeStore((state) => {
    const entry = state.byProperty[propertyId];
    return entry?.status === "live" && entry.topics.includes(topic);
  });
}
