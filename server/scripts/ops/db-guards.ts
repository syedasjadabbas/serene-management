/**
 * Tables whose rows are never deleted: append-only ledgers and delete-guarded
 * records. Each has a row-level guard trigger and, since migration
 * 20261101090000_truncate_guards, a statement-level BEFORE TRUNCATE guard.
 */
export const GUARDED_TABLES = [
  "audit_logs",
  "folio_items",
  "room_status_history",
  "cash_movements",
  "loyalty_transactions",
  "loyalty_membership_changes",
  "daily_statistics",
  "daily_room_type_statistics",
  "night_audit_steps",
  "invoices",
  "business_dates",
  "folios",
  "payments",
  "refunds",
  "night_audit_runs",
] as const;
