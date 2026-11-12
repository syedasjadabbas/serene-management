/** Types used by the frontDesk endpoints (re-exported from the shared contracts). */
export type {
  CheckInInput,
  CheckOutInput,
  ExtendStayInput,
  ReverseCheckInInput,
  RoomMoveInput,
  WalkInInput,
} from "@serene/shared/modules/front-desk/front-desk.schema";
export type {
  ArrivalRow,
  FrontDeskSummary,
  RoomOption,
  StayDetail,
  StayRow,
} from "@serene/shared/modules/front-desk/front-desk.types";
export type { RoomBoardRow } from "@serene/shared/modules/rooms/rooms.types";
