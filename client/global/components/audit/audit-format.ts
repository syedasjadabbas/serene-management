/**
 * Shared presentation of audit rows: readable field names and values, with
 * internal ids left out (the record itself is on screen, and the exact
 * action code stays available to auditors next to the label).
 */

/** Organization-wide wording for audit action codes. */
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Sign-in failed",
  "auth.login_rejected": "Sign-in refused",
  "auth.account_locked": "Account locked after failed sign-ins",
  "auth.password_change": "Password changed",
  "auth.password_change_failed": "Password change failed",
  "auth.password_reset_complete": "Password set from a link",
  "auth.refresh_token_reuse": "Reused sign-in token detected",
  "auth.session_revoke": "Session signed out",
  "user.invite": "User invited",
  "user.role_grant": "Role granted",
  "user.role_revoke": "Role removed",
  "user.disable": "User disabled",
  "user.enable": "User enabled",
  "user.unlock": "User unlocked",
  "user.password_reset_issue": "Password link issued",
  "user.profile_update": "Profile updated",
  "user.avatar_update": "Profile photo changed",
  "user.avatar_remove": "Profile photo removed",
  "organization.bootstrap": "Organization created",
  "property.create": "Property created",
  "property.setup_copy": "Property setup copied",
  "property.configuration_update": "Property settings changed",
  "setup.room_type_create": "Room type added",
  "setup.room_type_update": "Room type changed",
  "setup.floor_create": "Floor added",
  "setup.floor_update": "Floor changed",
  "setup.rooms_create": "Rooms added",
  "setup.room_update": "Room changed",
  "setup.tax_create": "Tax added",
  "setup.tax_update": "Tax changed",
  "business_date.initialize": "Property went live",
  "business_date.close": "Business date closed",
  "nightaudit.start": "Night audit started",
  "nightaudit.run": "Night audit completed",
  "nightaudit.recover": "Night audit recovered",
  "reservation.create": "Reservation created",
  "reservation.update": "Reservation modified",
  "reservation.confirm": "Reservation confirmed",
  "reservation.cancel": "Reservation cancelled",
  "reservation.no_show": "Marked no-show",
  "reservation.reinstate": "Reservation reinstated",
  "reservation.reinstate_no_show": "No-show reinstated",
  "reservation.room_assign": "Room assigned",
  "reservation.room_unassign": "Room removed from booking",
  "reservation.company": "Booking company changed",
  "reservation.package_add": "Package added to booking",
  "reservation.package_remove": "Package removed from booking",
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
  "guest.create": "Guest profile created",
  "guest.update": "Guest profile changed",
  "guest.preferences": "Guest preferences changed",
  "guest.note_add": "Guest note added",
  "guest.note_delete": "Guest note removed",
  "account.create": "Company / agent created",
  "account.update": "Company / agent changed",
  "account.contact_add": "Company contact added",
  "account.contact_update": "Company contact changed",
  "account.contact_remove": "Company contact removed",
  "group.create": "Group created",
  "group.update": "Group changed",
  "group.close": "Group closed",
  "group.cancel": "Group cancelled",
  "block.create": "Block created",
  "block.allocation": "Block allocation changed",
  "block.status": "Block status changed",
  "block.release": "Block rooms released",
  "block.cutoff": "Block cut-off applied",
  "block.pickup": "Rooms picked up from block",
  "rate_plan.create": "Rate plan created",
  "rate_plan.update": "Rate plan changed",
  "rate_plan.accounts": "Rate plan companies changed",
  "rate_plan.packages": "Rate plan packages changed",
  "rate_season.create": "Rate season added",
  "rate_season.update": "Rate season changed",
  "rate_season.delete": "Rate season removed",
  "package.create": "Package created",
  "package.update": "Package changed",
  "loyalty.program_create": "Loyalty program created",
  "loyalty.program_update": "Loyalty program changed",
  "loyalty.tier_create": "Loyalty tier added",
  "loyalty.tier_update": "Loyalty tier changed",
  "loyalty.enroll": "Loyalty membership enrolled",
  "loyalty.membership_change": "Loyalty membership changed",
  "loyalty.points_adjust": "Loyalty points adjusted",
  "housekeeping.room_inspect_pass": "Room passed inspection",
  "housekeeping.room_inspect_fail": "Room failed inspection",
  "housekeeping.task_create": "Housekeeping task created",
  "housekeeping.task_assign": "Housekeeping task assigned",
  "maintenance.create": "Maintenance request created",
  "maintenance.assign": "Maintenance request assigned",
  "maintenance.resolve": "Maintenance request resolved",
  "maintenance.block_room": "Room blocked for maintenance",
  "room.return_to_service": "Room returned to service",
};

/** "housekeeping.room_mark_clean" → "Housekeeping: room mark clean" for codes without wording. */
export function auditActionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const [area = "", ...rest] = action.split(".");
  const words = (text: string) => text.replaceAll("_", " ").trim();
  const head = words(area);
  const tail = words(rest.join(" "));
  const sentence = tail ? `${head}: ${tail}` : head;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

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
export function auditFieldLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Status and state fields hold enums; other upper-case values are codes (BAR, STD, PKR). */
function isEnumKey(key: string): boolean {
  return /(?:status|state)$/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function display(value: unknown, key = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const shown = value.filter((v) => !(typeof v === "string" && UUID.test(v)));
    if (shown.length === 0) return "—";
    // Lists of records (block nights, allocations) read one record per item.
    return shown.map((v) => display(v, key)).join(shown.some(isRecord) ? "; " : ", ");
  }
  if (isRecord(value)) {
    // A nested record reads "Date 2026-10-13, rooms 1"; its internal ids are left out.
    const parts = Object.entries(value)
      .filter(([k, v]) => !hidden(k, v))
      .map(([k, v]) => `${auditFieldLabel(k).toLowerCase()} ${display(v, k)}`);
    if (parts.length === 0) return "—";
    const text = parts.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
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

export interface AuditChange {
  key: string;
  before?: string;
  after?: string;
}

/** The fields an entry changed (both sides), or the values it recorded (one side). */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
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
