import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/format";

export interface AuditHistoryEntry {
  id: string;
  at: string;
  action: string;
  userDisplayName: string | null;
  risk: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

const ACTIONS: Record<string, string> = {
  "reservation.create": "Created",
  "reservation.update": "Modified",
  "reservation.confirm": "Confirmed",
  "reservation.cancel": "Cancelled",
  "reservation.no_show": "Marked no-show",
  "reservation.reinstate": "Reinstated",
  "reservation.reinstate_no_show": "No-show reinstated",
  "reservation.room_assign": "Room assigned",
  "reservation.room_unassign": "Room removed",
  "stay.check_in": "Checked in",
  "stay.room_move": "Room move",
  "stay.check_out": "Checked out",
  "stay.extend": "Stay extended",
  "folio.open": "Folio window opened",
  "folio.post_charge": "Charge posted",
  "folio.post_room_charges": "Room charges posted",
  "folio.post_no_show_fee": "No-show fee posted",
  "folio.reverse": "Charge reversed",
  "folio.adjust": "Charge adjusted",
  "folio.payment": "Payment taken",
  "folio.void_payment": "Payment voided",
  "folio.refund": "Payment refunded",
  "folio.settle": "Window settled",
};

function summarize(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "meta" && !key.endsWith("Ids"))
    .map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/** Audit-based history of a reservation, stay or folio (newest first). */
export function AuditHistory({
  entries,
  timezone,
}: {
  entries: AuditHistoryEntry[];
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
