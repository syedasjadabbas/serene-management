/**
 * Cache tags shared by room, housekeeping, maintenance and front desk data:
 * a command in any of them can change what the others show (room board,
 * task lists, readiness at check-in), so they invalidate together.
 */
export function operationsTags(propertyId: string) {
  return [
    { type: "RoomStatus" as const, id: `BOARD-${propertyId}` },
    { type: "HousekeepingTask" as const, id: `LIST-${propertyId}` },
    { type: "MaintenanceRequest" as const, id: `LIST-${propertyId}` },
    { type: "Stay" as const, id: `FD-${propertyId}` },
    { type: "Availability" as const, id: propertyId },
  ];
}
