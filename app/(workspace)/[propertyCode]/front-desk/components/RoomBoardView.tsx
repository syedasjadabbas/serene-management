"use client";

import { RoomBoardPanel } from "@/components/rooms/RoomBoardPanel";

/**
 * Front desk room board: the shared board (occupancy, readiness, service and
 * housekeeping state, today's arrivals and departures) for the business date.
 */
export function RoomBoardView({
  filter,
  onClearFilter,
}: {
  filter: string;
  onClearFilter: () => void;
}) {
  return <RoomBoardPanel filter={filter} onClearFilter={onClearFilter} />;
}
