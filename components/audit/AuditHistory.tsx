import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal references (ids) mean nothing to hotel staff; the record itself is on screen. */
function hidden(key: string, value: unknown): boolean {
  return (
    key === "meta" ||
    key.endsWith("Id") ||
    key.endsWith("Ids") ||
    (typeof value === "string" && UUID.test(value))
  );
}

/** roomFrontOfficeStatus → "Room front office status". */
function label(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Status and state fields hold enums; other upper-case values are codes (BAR, STD, PKR). */
function isEnumKey(key: string): boolean {
  return /(?:status|state)$/i.test(key);
}

function display(value: unknown, key = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length === 0 ? "—" : value.map((v) => display(v, key)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  // Money travels as a decimal string (31320.0000, 40500.00): grouped, at least 2 places.
  const money = /^(-?)(\d+)\.(\d{2}|\d{4})$/.exec(text);
  if (money) {
    const fraction = money[3]!.replace(/0+$/, "").padEnd(2, "0");
    return `${money[1]}${money[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
  }
  // Enum values (IN_HOUSE, VACANT) read as words (In house, Vacant).
  if (/^[A-Z][A-Z0-9_]+$/.test(text) && (text.includes("_") || isEnumKey(key))) {
    const words = text.replaceAll("_", " ").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return text;
}

interface Change {
  key: string;
  before?: string;
  after?: string;
}

/** The fields an entry changed (both sides), or the values it recorded (one side). */
function changes(before: unknown, after: unknown): Change[] {
  const b = before && typeof before === "object" ? (before as Record<string, unknown>) : null;
  const a = after && typeof after === "object" ? (after as Record<string, unknown>) : null;
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  return keys
    .filter((key) => !hidden(key, a?.[key] ?? b?.[key]))
    .map((key) => ({
      key,
      before: b && key in b ? display(b[key], key) : undefined,
      after: a && key in a ? display(a[key], key) : undefined,
    }))
    .filter((c) => !(b && a && c.before !== undefined && c.before === c.after));
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
    <Card title="History">
      {entries.length === 0 ? (
        <p className="text-sm text-fg-secondary">No recorded changes.</p>
      ) : (
        <ol className="-my-3 flex flex-col divide-y divide-border-subtle text-sm">
          {entries.map((entry) => {
            const list = changes(entry.before, entry.after);
            return (
              <li key={entry.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">
                    {ACTIONS[entry.action] ?? label(entry.action)}
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
                        <dt className="text-fg-muted">{label(c.key)}</dt>
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
