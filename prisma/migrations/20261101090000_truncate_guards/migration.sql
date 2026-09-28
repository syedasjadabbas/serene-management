-- Phase 10 batch 3 (L8): TRUNCATE guards for append-only and delete-guarded tables.
--
-- The append-only and immutability triggers are row-level BEFORE UPDATE OR
-- DELETE triggers. PostgreSQL never fires row-level triggers for TRUNCATE, so
-- a TRUNCATE (directly, or through TRUNCATE ... CASCADE on a parent table)
-- emptied these tables without any check. A statement-level BEFORE TRUNCATE
-- trigger closes that gap; it also fires for tables reached by CASCADE.
--
-- Additive only: no table, column or data changes. The existing
-- serene_reject_mutation() raises SM001 and names the table and operation.
-- See docs/DATABASE_DESIGN.md §5 and docs/ARCHITECTURE.md D51.

-- Append-only ledgers (corrections are new rows).
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "folio_items_no_truncate"
  BEFORE TRUNCATE ON "folio_items"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "room_status_history_no_truncate"
  BEFORE TRUNCATE ON "room_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "cash_movements_no_truncate"
  BEFORE TRUNCATE ON "cash_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "loyalty_transactions_no_truncate"
  BEFORE TRUNCATE ON "loyalty_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "loyalty_membership_changes_no_truncate"
  BEFORE TRUNCATE ON "loyalty_membership_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "daily_statistics_no_truncate"
  BEFORE TRUNCATE ON "daily_statistics"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "daily_room_type_statistics_no_truncate"
  BEFORE TRUNCATE ON "daily_room_type_statistics"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "night_audit_steps_no_truncate"
  BEFORE TRUNCATE ON "night_audit_steps"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

-- Tables whose rows may change state but are never deleted.
CREATE TRIGGER "invoices_no_truncate"
  BEFORE TRUNCATE ON "invoices"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "business_dates_no_truncate"
  BEFORE TRUNCATE ON "business_dates"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "folios_no_truncate"
  BEFORE TRUNCATE ON "folios"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "payments_no_truncate"
  BEFORE TRUNCATE ON "payments"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "refunds_no_truncate"
  BEFORE TRUNCATE ON "refunds"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "night_audit_runs_no_truncate"
  BEFORE TRUNCATE ON "night_audit_runs"
  FOR EACH STATEMENT EXECUTE FUNCTION serene_reject_mutation();
