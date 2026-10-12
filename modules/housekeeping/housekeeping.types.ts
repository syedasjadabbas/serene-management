import type { RoomReadiness } from "@/modules/rooms/rooms.policy";
import type { TaskPriority, TaskStatus } from "./housekeeping.policy";

/** Housekeeping contracts (Phase 4). */

export interface TaskView {
  id: string;
  version: number;
  businessDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  room: {
    id: string;
    number: string;
    floor: string | null;
    roomTypeCode: string;
    housekeepingStatus: string;
    frontOfficeStatus: string;
    readiness: RoomReadiness;
    version: number;
  };
  type: { id: string; code: string; name: string; requiresInspection: boolean };
  attendant: { id: string; name: string; userId: string | null } | null;
  mine: boolean;
  arrivingToday: boolean;
  awaitingInspection: boolean;
  /** What to do (tasks added by hand); null for automatic tasks. */
  description: string | null;
  /** Target time on the task's business date, property-local "HH:MM". */
  scheduledTime: string | null;
  /** Dated after the business date: waits in the Scheduled view, cannot be worked yet. */
  scheduledAhead: boolean;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  inspectedAt: string | null;
  inspectedBy: string | null;
  allowedActions: {
    assign: boolean;
    start: boolean;
    pause: boolean;
    complete: boolean;
    skip: boolean;
    cancel: boolean;
    inspect: boolean;
  };
}

export interface HousekeepingSummary {
  businessDate: string;
  tasks: {
    open: number;
    pending: number;
    inProgress: number;
    awaitingInspection: number;
    completedToday: number;
    mine: number;
    unassigned: number;
    /** Open tasks added for a later business date (Scheduled view). */
    scheduled: number;
  };
}

export interface TaskTypeView {
  id: string;
  code: string;
  name: string;
  requiresInspection: boolean;
  changesRoomStatus: boolean;
  estimatedMinutes: number;
}

export interface AssigneeView {
  id: string;
  displayName: string;
}
