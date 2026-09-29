import { BedDouble } from "lucide-react";
import type { SelectOption } from "@/components/ui/Select";
import type { AvailableRoomView } from "@/modules/reservations/reservations.types";

const titleCase = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");

/**
 * Free rooms as dropdown options: "Room 204", a status line (occupancy,
 * housekeeping, accessible, smoking, out of service) and one group per
 * floor, so the room dropdowns read the same everywhere.
 */
export function availableRoomOptions(rooms: readonly AvailableRoomView[]): SelectOption[] {
  return [...rooms]
    .sort(
      (a, b) =>
        (a.floor ?? "").localeCompare(b.floor ?? "") ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    )
    .map((room) => ({
      value: room.id,
      label: `Room ${room.number}`,
      description: [
        titleCase(room.frontOfficeStatus),
        titleCase(room.housekeepingStatus),
        room.isAccessible ? "Accessible" : null,
        room.isSmoking ? "Smoking" : null,
        room.outOfService ? "Out of service" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      group: room.floor ?? "No floor",
      icon: BedDouble,
    }));
}
