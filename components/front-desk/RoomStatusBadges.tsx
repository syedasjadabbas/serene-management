import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ARRIVAL_STATE_LABELS, type ArrivalState } from "@/modules/front-desk/front-desk.policy";
import {
  READINESS_LABELS,
  ROOM_BOARD_STATUS_LABELS,
  type RoomBoardStatus,
  type RoomReadiness,
} from "@/modules/rooms/rooms.policy";

const READINESS_TONES: Record<RoomReadiness, BadgeTone> = {
  READY: "success",
  OCCUPIED: "danger",
  OUT_OF_ORDER: "danger",
  DIRTY: "warning",
  NOT_INSPECTED: "warning",
};

/** Whether a guest can be put into the room now. */
export function RoomReadinessBadge({ readiness }: { readiness: RoomReadiness }) {
  return <Badge tone={READINESS_TONES[readiness]}>{READINESS_LABELS[readiness]}</Badge>;
}

const BOARD_TONES: Record<RoomBoardStatus, BadgeTone> = {
  OUT_OF_ORDER: "danger",
  OCCUPIED: "info",
  VACANT_READY: "success",
  VACANT_NOT_READY: "warning",
};

export function RoomBoardStatusBadge({ status }: { status: RoomBoardStatus }) {
  return <Badge tone={BOARD_TONES[status]}>{ROOM_BOARD_STATUS_LABELS[status]}</Badge>;
}

const ARRIVAL_TONES: Record<ArrivalState, BadgeTone> = {
  CHECKED_IN: "success",
  NEEDS_CONFIRMATION: "warning",
  UNASSIGNED: "neutral",
  ROOM_NOT_READY: "warning",
  READY: "info",
};

export function ArrivalStateBadge({ state }: { state: ArrivalState }) {
  return <Badge tone={ARRIVAL_TONES[state]}>{ARRIVAL_STATE_LABELS[state]}</Badge>;
}
