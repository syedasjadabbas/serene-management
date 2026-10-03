import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/utils/format";
import { auditActionLabel, auditChanges, auditFieldLabel } from "./audit-format";

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
  "stay.reverse_check_in": "Check-in reversed",
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

/** Audit-based history of a reservation, stay or folio (newest first). */
export function AuditHistory({
  entries,
  timezone,
}: {
  entries: AuditHistoryEntry[];
  timezone: string;
}) {
  return (
    <Card title="History">
      {entries.length === 0 ? (
        <p className="text-sm text-fg-secondary">No recorded changes.</p>
      ) : (
        <ol className="-my-3 flex flex-col divide-y divide-border-subtle text-sm">
          {entries.map((entry) => {
            const list = auditChanges(entry.before, entry.after);
            return (
              <li key={entry.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">
                    {ACTIONS[entry.action] ?? auditActionLabel(entry.action)}
                  </span>
                  {entry.risk === "HIGH" ? <Badge tone="warning">High risk</Badge> : null}
                  <span className="text-xs text-fg-muted">
                    {formatDateTime(entry.at, timezone)}
                    {entry.userDisplayName ? ` · ${entry.userDisplayName}` : ""}
                  </span>
                </div>
                {entry.reason ? (
                  <p className="text-sm text-fg-secondary">Reason: {entry.reason}</p>
                ) : null}
                {list.length > 0 ? (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-md bg-surface-sunken px-3 py-2.5 text-xs sm:grid-cols-[minmax(9rem,max-content)_1fr]">
                    {list.map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-fg-muted">{auditFieldLabel(c.key)}</dt>
                        <dd className="min-w-0 break-words text-fg">
                          {c.before !== undefined && c.after !== undefined ? (
                            <>
                              <span className="text-fg-muted line-through decoration-fg-muted/50">
                                {c.before}
                              </span>
                              <span aria-hidden="true" className="px-1.5 text-fg-muted">
                                →
                              </span>
                              <span className="sr-only"> changed to </span>
                              {c.after}
                            </>
                          ) : (
                            (c.after ?? c.before)
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
