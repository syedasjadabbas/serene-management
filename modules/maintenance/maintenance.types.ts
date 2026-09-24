import type { MaintenancePriority, MaintenanceStatus } from "./maintenance.policy";

/** Maintenance contracts (Phase 4). */

export interface MaintenanceListItem {
  id: string;
  requestNumber: string;
  version: number;
  title: string;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  room: { id: string; number: string } | null;
  location: string | null;
  category: { id: string; code: string; name: string };
  assignee: { id: string; name: string } | null;
  mine: boolean;
  reportedAt: string;
  resolvedAt: string | null;
  /** A live out-of-order / out-of-service block was placed for this request. */
  roomBlocked: "OUT_OF_ORDER" | "OUT_OF_SERVICE" | null;
}

export interface MaintenanceDetail extends MaintenanceListItem {
  description: string | null;
  reportedBy: string | null;
  closedAt: string | null;
  resolution: string | null;
  blocks: {
    id: string;
    kind: string;
    status: string;
    from: string;
    to: string;
  }[];
  activities: {
    id: string;
    type: string;
    body: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    by: string | null;
    at: string;
  }[];
  allowedActions: {
    assign: boolean;
    start: boolean;
    hold: boolean;
    resume: boolean;
    resolve: boolean;
    close: boolean;
    reopen: boolean;
    cancel: boolean;
    blockRoom: boolean;
    note: boolean;
  };
}

export interface MaintenanceOptions {
  categories: { id: string; code: string; name: string }[];
  assignees: { id: string; displayName: string }[];
  blockReasons: { id: string; code: string; name: string; category: string }[];
}
