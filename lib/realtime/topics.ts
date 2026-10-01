import type { Permission } from "@/lib/permissions/catalog";

/**
 * Live update topics (docs/SCALABILITY.md §31). A topic names data a screen
 * shows, never data itself: an event says "the front desk of property P
 * changed", and the screen refetches through the normal, authorized API.
 */
export const REALTIME_TOPICS = ["frontdesk", "rooms", "housekeeping", "businessdate"] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export function isRealtimeTopic(value: string): value is RealtimeTopic {
  return (REALTIME_TOPICS as readonly string[]).includes(value);
}

/**
 * The permission a topic's data needs at the property (null: any user with
 * access to the property, e.g. the business date every page shows).
 */
export const TOPIC_PERMISSION: Record<RealtimeTopic, Permission | null> = {
  frontdesk: "frontdesk:read",
  rooms: "rooms:read",
  housekeeping: "housekeeping:read",
  businessdate: null,
};

/** Topics a user may follow at a property, from their permissions there. */
export function topicsFor(can: (permission: Permission) => boolean): RealtimeTopic[] {
  return REALTIME_TOPICS.filter((topic) => {
    const permission = TOPIC_PERMISSION[topic];
    return permission === null || can(permission);
  });
}

/**
 * Least time between two refetches of a topic caused by events, per screen.
 * The first change after a quiet period is shown at once; during a burst a
 * screen refetches at most once per gap. Every connected screen refetches on
 * every change, so for the heavy lists (≈45 ms of PostgreSQL each, measured)
 * the gap equals the former polling interval: a busy property never costs
 * more than polling did, and a quiet one costs nothing (docs/SCALABILITY.md
 * §31: with a 30 s gap, one change a minute already cost as much as polling).
 */
export const TOPIC_REFETCH_GAP_MS: Record<RealtimeTopic, number> = {
  frontdesk: 60_000,
  rooms: 60_000,
  housekeeping: 15_000,
  businessdate: 0,
};

/**
 * Random delay (0–this) before an event's refetch, so the screens of one
 * property do not all query the database in the same instant. Measured with
 * 32 screens: refetched within 2 s, the front desk lists read 17 % more rows
 * each than one at a time; within 5 s, the same as one at a time.
 */
export const TOPIC_REFETCH_SPREAD_MS: Record<RealtimeTopic, number> = {
  frontdesk: 5_000,
  rooms: 5_000,
  housekeeping: 2_000,
  businessdate: 5_000,
};

/**
 * While live, converted screens still refetch this rarely: a safety net for
 * data the change notifications do not cover (e.g. a guest renamed at
 * organization level).
 */
export const LIVE_SAFETY_REFETCH_MS = 10 * 60_000;
