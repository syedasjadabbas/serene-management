/**
 * Cache tags shared by room, housekeeping, maintenance and front desk data:
 * a command in any of them can change what the others show (room board,
 * task lists, readiness at check-in), so they invalidate together.
 * Availability depends on occupancy and service blocks, not on cleaning
 * status: housekeeping-only commands leave it alone (B11).
 */
export function operationsTags(propertyId: string, options: { availability?: boolean } = {}) {
  return [
    { type: "RoomStatus" as const, id: `BOARD-${propertyId}` },
    { type: "HousekeepingTask" as const, id: `LIST-${propertyId}` },
    { type: "MaintenanceRequest" as const, id: `LIST-${propertyId}` },
    { type: "Stay" as const, id: `FD-${propertyId}` },
    ...(options.availability === false ? [] : [{ type: "Availability" as const, id: propertyId }]),
  ];
}
