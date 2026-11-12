-- Phase 8: night audit, business-date roll, finance and reports
-- (docs/ARCHITECTURE.md D30-D34, DATABASE_DESIGN.md §5 "Phase 8").

-- ---------------------------------------------------------------------------
-- Prisma-expressible changes
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "daily_statistics" ADD COLUMN     "adjustments_total" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "currency_code" CHAR(3) NOT NULL,
ADD COLUMN     "ledger_closing_balance" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "ledger_opening_balance" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "no_show_revenue" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "refunds_total" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "voids_total" DECIMAL(19,4) NOT NULL;

-- AlterTable
ALTER TABLE "property_configurations" ADD COLUMN     "no_show_reason_code_id" UUID,
ADD COLUMN     "no_show_transaction_code_id" UUID;

-- AlterTable
ALTER TABLE "reservation_rooms" ADD COLUMN     "cancellation_business_date" DATE,
ADD COLUMN     "no_show_business_date" DATE;

-- CreateIndex
CREATE INDEX "reservation_rooms_property_id_cancellation_business_date_idx" ON "reservation_rooms"("property_id", "cancellation_business_date");

-- CreateIndex
CREATE INDEX "reservation_rooms_property_id_no_show_business_date_idx" ON "reservation_rooms"("property_id", "no_show_business_date");

-- AddForeignKey
ALTER TABLE "property_configurations" ADD CONSTRAINT "property_configurations_property_id_no_show_transaction_co_fkey" FOREIGN KEY ("property_id", "no_show_transaction_code_id") REFERENCES "transaction_codes"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_configurations" ADD CONSTRAINT "property_configurations_property_id_no_show_reason_code_id_fkey" FOREIGN KEY ("property_id", "no_show_reason_code_id") REFERENCES "reason_codes"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules (DATABASE_DESIGN.md §5)
-- ---------------------------------------------------------------------------

-- Backfill the business date of existing cancellations and no-shows: the
-- business date recorded on the command's audit row, else the property-local
-- calendar date of the timestamp.
UPDATE "reservation_rooms" rr
SET "cancellation_business_date" = COALESCE(
      (SELECT a."business_date" FROM "audit_logs" a
        WHERE a."resource_id" = rr."id"::text AND a."action" = 'reservation.cancel'
        ORDER BY a."created_at" DESC LIMIT 1),
      (COALESCE(rr."cancelled_at", rr."updated_at") AT TIME ZONE p."timezone")::date)
FROM "properties" p
WHERE p."id" = rr."property_id" AND rr."status" = 'CANCELLED';

UPDATE "reservation_rooms" rr
SET "no_show_business_date" = COALESCE(
      (SELECT a."business_date" FROM "audit_logs" a
        WHERE a."resource_id" = rr."id"::text AND a."action" = 'reservation.no_show'
        ORDER BY a."created_at" DESC LIMIT 1),
      (COALESCE(rr."no_show_at", rr."updated_at") AT TIME ZONE p."timezone")::date)
FROM "properties" p
WHERE p."id" = rr."property_id" AND rr."status" = 'NO_SHOW';

-- The business date of a cancellation / no-show exists exactly while the
-- room is in that state (reinstatement clears it).
ALTER TABLE "reservation_rooms"
  ADD CONSTRAINT "reservation_rooms_cancellation_date_chk"
    CHECK (("status" = 'CANCELLED') = ("cancellation_business_date" IS NOT NULL)),
  ADD CONSTRAINT "reservation_rooms_no_show_date_chk"
    CHECK (("status" = 'NO_SHOW') = ("no_show_business_date" IS NOT NULL));

-- Posting-date lock (D32): financial facts, audit runs and statistics are
-- written only for the property's current business date (OPEN, or IN_AUDIT
-- while night audit commits). A closed date can never receive new rows, and
-- no row can be dated ahead of the current date.
CREATE OR REPLACE FUNCTION serene_posting_date_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_business_date date;
BEGIN
  SELECT bd."date" INTO current_business_date
  FROM "business_dates" bd
  WHERE bd."property_id" = NEW."property_id" AND bd."is_current";
  IF current_business_date IS NULL OR NEW."business_date" IS DISTINCT FROM current_business_date THEN
    RAISE EXCEPTION '% rows must carry the current business date (% given, % current)',
      TG_TABLE_NAME, NEW."business_date", current_business_date
      USING ERRCODE = 'SM004';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "folio_items_posting_date"
  BEFORE INSERT ON "folio_items"
  FOR EACH ROW EXECUTE FUNCTION serene_posting_date_guard();

CREATE TRIGGER "payments_posting_date"
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION serene_posting_date_guard();

CREATE TRIGGER "refunds_posting_date"
  BEFORE INSERT ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION serene_posting_date_guard();

CREATE TRIGGER "night_audit_runs_posting_date"
  BEFORE INSERT ON "night_audit_runs"
  FOR EACH ROW EXECUTE FUNCTION serene_posting_date_guard();

CREATE TRIGGER "daily_statistics_posting_date"
  BEFORE INSERT ON "daily_statistics"
  FOR EACH ROW EXECUTE FUNCTION serene_posting_date_guard();

CREATE TRIGGER "daily_room_type_statistics_posting_date"
  BEFORE INSERT ON "daily_room_type_statistics"
  FOR EACH ROW EXECUTE FUNCTION serene_posting_date_guard();

-- Statistics snapshots of a closed date are frozen.
CREATE TRIGGER "daily_statistics_append_only"
  BEFORE UPDATE OR DELETE ON "daily_statistics"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "daily_room_type_statistics_append_only"
  BEFORE UPDATE OR DELETE ON "daily_room_type_statistics"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

-- Night-audit runs: attempt numbers from 1; finished exactly when no longer
-- RUNNING; a finished run (COMPLETED / FAILED) is history and never changes;
-- identity columns never change; runs are never deleted.
ALTER TABLE "night_audit_runs"
  ADD CONSTRAINT "night_audit_runs_attempt_chk" CHECK ("attempt" >= 1),
  ADD CONSTRAINT "night_audit_runs_finished_chk"
    CHECK (("status" = 'RUNNING') = ("finished_at" IS NULL));

CREATE OR REPLACE FUNCTION serene_night_audit_run_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Night audit runs cannot be deleted' USING ERRCODE = 'SM001';
  END IF;
  IF OLD."status" <> 'RUNNING' THEN
    RAISE EXCEPTION 'A finished night audit run is immutable' USING ERRCODE = 'SM001';
  END IF;
  IF NEW."property_id" <> OLD."property_id" OR NEW."business_date" <> OLD."business_date"
     OR NEW."attempt" <> OLD."attempt" OR NEW."started_by_id" <> OLD."started_by_id"
     OR NEW."started_at" <> OLD."started_at" THEN
    RAISE EXCEPTION 'Night audit run identity cannot change' USING ERRCODE = 'SM001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "night_audit_runs_guard"
  BEFORE UPDATE OR DELETE ON "night_audit_runs"
  FOR EACH ROW EXECUTE FUNCTION serene_night_audit_run_guard();

-- Steps are the run's record: written once, never changed (the run row
-- cascades nothing because runs cannot be deleted).
ALTER TABLE "night_audit_steps"
  ADD CONSTRAINT "night_audit_steps_code_chk" CHECK ("code" IN (
    'VALIDATE_DEPARTURES', 'VALIDATE_ARRIVALS', 'VALIDATE_BALANCES', 'VALIDATE_PAYMENTS',
    'VALIDATE_ROOM_STATUS', 'VALIDATE_POSTING', 'VALIDATE_CASHIERS',
    'POST_ROOM_AND_TAX', 'PROCESS_NO_SHOWS', 'RELEASE', 'ROOM_STATUS_ROLL',
    'RECONCILE_INVENTORY', 'STATISTICS', 'CLOSE_DATE'));

CREATE TRIGGER "night_audit_steps_append_only"
  BEFORE UPDATE OR DELETE ON "night_audit_steps"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();
