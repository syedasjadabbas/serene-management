import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  PRIORITY_LABELS,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/modules/maintenance/maintenance.policy";

const PRIORITY_TONES: Record<MaintenancePriority, BadgeTone> = {
  URGENT: "danger",
  HIGH: "warning",
  NORMAL: "neutral",
  LOW: "neutral",
};

const STATUS: Record<MaintenanceStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Open", tone: "warning" },
  ASSIGNED: { label: "Assigned", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  ON_HOLD: { label: "On hold", tone: "neutral" },
  RESOLVED: { label: "Resolved", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  return <Badge tone={PRIORITY_TONES[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function StatusBadge({ status }: { status: MaintenanceStatus }) {
  const { label, tone } = STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
