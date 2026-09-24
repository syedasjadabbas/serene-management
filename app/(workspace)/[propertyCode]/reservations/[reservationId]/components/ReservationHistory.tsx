import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/format";
import type { ReservationHistoryEntry } from "@/modules/reservations/reservations.types";

const ACTIONS: Record<string, string> = {
  "reservation.create": "Created",
  "reservation.update": "Modified",
  "reservation.confirm": "Confirmed",
  "reservation.cancel": "Cancelled",
  "reservation.no_show": "Marked no-show",
  "reservation.reinstate": "Reinstated",
  "reservation.room_assign": "Room assigned",
  "reservation.room_unassign": "Room removed",
};

function summarize(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "meta" && !key.endsWith("Ids"))
    .map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/** Audit-based reservation history (newest first). */
export function ReservationHistory({
  entries,
  timezone,
}: {
  entries: ReservationHistoryEntry[];
  timezone: string;
}) {
  return (
    <section
      aria-labelledby="history-heading"
      className="rounded-lg border border-border-subtle bg-surface p-4"
    >
      <h2 id="history-heading" className="mb-2 text-lg font-semibold">
        History
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-secondary">No recorded changes.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border-subtle text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{ACTIONS[entry.action] ?? entry.action}</span>
                {entry.risk === "HIGH" ? <Badge tone="warning">High risk</Badge> : null}
                <span className="text-xs text-fg-muted">
                  {formatDateTime(entry.at, timezone)}
                  {entry.userDisplayName ? ` · ${entry.userDisplayName}` : ""}
                </span>
              </div>
              {entry.reason ? (
                <p className="text-xs text-fg-secondary">Reason: {entry.reason}</p>
              ) : null}
              {entry.before ? (
                <p className="font-mono text-2xs break-all text-fg-muted">
                  Before: {summarize(entry.before)}
                </p>
              ) : null}
              {entry.after ? (
                <p className="font-mono text-2xs break-all text-fg-muted">
                  After: {summarize(entry.after)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
