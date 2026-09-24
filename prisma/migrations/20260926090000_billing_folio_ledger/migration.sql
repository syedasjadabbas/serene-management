-- Phase 5: folios, charges, taxes, payments, refunds and settlement.
--
-- The ledger tables (folios, folio_items, payments, refunds, transaction
-- codes, tax rules) were created in Phase 0. This migration adds the
-- settlement columns and deterministic posting keys, and moves the folio
-- totals under database control: an insert trigger on folio_items maintains
-- charges_total / credits_total / balance / version, so they can never drift
-- from the ledger, and a guard rejects every other change to them.

-- AlterTable
ALTER TABLE "folio_items" ADD COLUMN     "posting_key" VARCHAR(120);

-- AlterTable
ALTER TABLE "folios" ADD COLUMN     "settled_at" TIMESTAMPTZ(3),
ADD COLUMN     "settled_by_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "folio_items_posting_key_key" ON "folio_items"("property_id", "posting_key") WHERE (posting_key IS NOT NULL);

-- Hand-written rules (Prisma cannot express them; docs/DATABASE_DESIGN.md §5) -----------

-- Sign convention: charges and taxes are debits (>= 0); a payment line is a
-- credit (< 0) and its refund line a debit (> 0); an adjustment is never zero.
ALTER TABLE "folio_items"
  ADD CONSTRAINT "folio_items_sign_chk" CHECK (
    ("kind" NOT IN ('CHARGE', 'TAX') OR "amount" >= 0)
    AND ("kind" <> 'PAYMENT'
         OR ("refund_id" IS NULL AND "amount" < 0)
         OR ("refund_id" IS NOT NULL AND "amount" > 0))
    AND ("kind" <> 'ADJUSTMENT' OR "amount" <> 0)
  ),
  ADD CONSTRAINT "folio_items_currency_chk" CHECK ("currency_code" ~ '^[A-Z]{3}$');

ALTER TABLE "folios"
  ADD CONSTRAINT "folios_settlement_chk" CHECK (
    (("status" = 'SETTLED') = ("settled_at" IS NOT NULL))
    AND (("settled_at" IS NULL) = ("settled_by_id" IS NULL))
  ),
  ADD CONSTRAINT "folios_closed_chk" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL)),
  ADD CONSTRAINT "folios_currency_chk" CHECK ("currency_code" ~ '^[A-Z]{3}$');

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_lifecycle_chk" CHECK (
    ("status" <> 'CAPTURED' OR "captured_at" IS NOT NULL)
    AND (("status" = 'VOIDED') = ("voided_at" IS NOT NULL))
    AND ("kind" <> 'PAYMENT' OR "folio_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "payments_currency_chk" CHECK ("currency_code" ~ '^[A-Z]{3}$');

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_lifecycle_chk" CHECK (("status" = 'PENDING') = ("completed_at" IS NULL)),
  ADD CONSTRAINT "refunds_currency_chk" CHECK ("currency_code" ~ '^[A-Z]{3}$');

-- Ledger insert: currency and correction integrity, then folio totals. ----------------
-- Runs AFTER INSERT so that multi-row inserts see each other (adjustment caps).
CREATE OR REPLACE FUNCTION serene_folio_item_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  folio_currency text;
  group_type text;
  corrected RECORD;
  adjusted_total numeric;
BEGIN
  SELECT "currency_code" INTO folio_currency FROM "folios" WHERE "id" = NEW."folio_id";
  IF NEW."currency_code" <> folio_currency THEN
    RAISE EXCEPTION 'Posting currency % differs from folio currency %',
      NEW."currency_code", folio_currency USING ERRCODE = 'SM003';
  END IF;

  IF NEW."kind" IN ('REVERSAL', 'ADJUSTMENT') THEN
    SELECT "folio_id", "kind", "amount" INTO corrected
      FROM "folio_items" WHERE "id" = NEW."corrects_item_id";
    IF corrected."folio_id" IS DISTINCT FROM NEW."folio_id"
       OR corrected."kind" IN ('REVERSAL', 'ADJUSTMENT') THEN
      RAISE EXCEPTION 'Item % cannot be corrected by this posting',
        NEW."corrects_item_id" USING ERRCODE = 'SM003';
    END IF;
    IF NEW."kind" = 'REVERSAL' THEN
      IF NEW."amount" <> -corrected."amount" THEN
        RAISE EXCEPTION 'A reversal must negate item % exactly',
          NEW."corrects_item_id" USING ERRCODE = 'SM003';
      END IF;
      IF EXISTS (SELECT 1 FROM "folio_items"
                 WHERE "corrects_item_id" = NEW."corrects_item_id" AND "kind" = 'ADJUSTMENT') THEN
        RAISE EXCEPTION 'Item % was adjusted and cannot be reversed',
          NEW."corrects_item_id" USING ERRCODE = 'SM003';
      END IF;
    ELSE
      IF sign(NEW."amount") = sign(corrected."amount") THEN
        RAISE EXCEPTION 'An adjustment must reduce item %',
          NEW."corrects_item_id" USING ERRCODE = 'SM003';
      END IF;
      IF EXISTS (SELECT 1 FROM "folio_items"
                 WHERE "corrects_item_id" = NEW."corrects_item_id" AND "kind" = 'REVERSAL') THEN
        RAISE EXCEPTION 'Item % was reversed and cannot be adjusted',
          NEW."corrects_item_id" USING ERRCODE = 'SM003';
      END IF;
      SELECT COALESCE(SUM("amount"), 0) INTO adjusted_total
        FROM "folio_items"
        WHERE "corrects_item_id" = NEW."corrects_item_id" AND "kind" = 'ADJUSTMENT';
      IF abs(adjusted_total) > abs(corrected."amount") THEN
        RAISE EXCEPTION 'Adjustments exceed item %',
          NEW."corrects_item_id" USING ERRCODE = 'SM003';
      END IF;
    END IF;
  END IF;

  -- Payment-group codes (payments, refunds and their reversals) are credits;
  -- every other code (revenue, taxes, wrappers) is a charge.
  SELECT g."type"::text INTO group_type
    FROM "transaction_codes" c
    JOIN "transaction_code_groups" g ON g."id" = c."group_id"
    WHERE c."id" = NEW."transaction_code_id";

  UPDATE "folios" SET
    "charges_total" = "charges_total" + CASE WHEN group_type = 'PAYMENT' THEN 0 ELSE NEW."amount" END,
    "credits_total" = "credits_total" + CASE WHEN group_type = 'PAYMENT' THEN NEW."amount" ELSE 0 END,
    "balance"       = "balance" + NEW."amount",
    -- A posting reopens a settled folio (DOMAIN_MODEL §6.4).
    "status"        = CASE WHEN "status" = 'SETTLED' THEN 'OPEN'::"folio_status" ELSE "status" END,
    "settled_at"    = CASE WHEN "status" = 'SETTLED' THEN NULL ELSE "settled_at" END,
    "settled_by_id" = CASE WHEN "status" = 'SETTLED' THEN NULL ELSE "settled_by_id" END,
    "version"       = "version" + 1,
    "updated_at"    = now()
  WHERE "id" = NEW."folio_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "folio_items_apply"
  AFTER INSERT ON "folio_items"
  FOR EACH ROW EXECUTE FUNCTION serene_folio_item_apply();

-- Folio totals belong to the ledger trigger: a new folio starts at zero, and
-- only the trigger (nested, depth > 1) may change them. Ownership and currency
-- are fixed at creation; folios are never deleted.
CREATE OR REPLACE FUNCTION serene_folio_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Folios cannot be deleted' USING ERRCODE = 'SM001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."charges_total" <> 0 OR NEW."credits_total" <> 0 OR NEW."balance" <> 0 THEN
      RAISE EXCEPTION 'A folio opens with zero totals' USING ERRCODE = 'SM001';
    END IF;
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() = 1 AND (
       NEW."charges_total" <> OLD."charges_total"
       OR NEW."credits_total" <> OLD."credits_total"
       OR NEW."balance" <> OLD."balance") THEN
    RAISE EXCEPTION 'Folio % totals are maintained by the ledger', OLD."id" USING ERRCODE = 'SM001';
  END IF;
  IF NEW."currency_code" <> OLD."currency_code"
     OR NEW."property_id" <> OLD."property_id"
     OR NEW."owner_type" <> OLD."owner_type"
     OR NEW."window" <> OLD."window"
     OR NEW."reservation_room_id" IS DISTINCT FROM OLD."reservation_room_id"
     OR NEW."block_id" IS DISTINCT FROM OLD."block_id" THEN
    RAISE EXCEPTION 'Folio % ownership and currency are fixed', OLD."id" USING ERRCODE = 'SM001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "folios_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "folios"
  FOR EACH ROW EXECUTE FUNCTION serene_folio_guard();

-- Payments: the money facts are immutable once recorded; only status,
-- refunded amount (never decreasing) and void details change. Never deleted.
CREATE OR REPLACE FUNCTION serene_payment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted' USING ERRCODE = 'SM001';
  END IF;
  IF NEW."amount" <> OLD."amount"
     OR NEW."currency_code" <> OLD."currency_code"
     OR NEW."kind" <> OLD."kind"
     OR NEW."property_id" <> OLD."property_id"
     OR NEW."folio_id" IS DISTINCT FROM OLD."folio_id"
     OR NEW."method_id" <> OLD."method_id"
     OR NEW."business_date" <> OLD."business_date"
     OR NEW."refunded_amount" < OLD."refunded_amount" THEN
    RAISE EXCEPTION 'Payment % is immutable', OLD."id" USING ERRCODE = 'SM001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_guard"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION serene_payment_guard();

-- Refunds: final once completed; never deleted.
CREATE OR REPLACE FUNCTION serene_refund_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Refund % is final', OLD."id" USING ERRCODE = 'SM001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "refunds_guard"
  BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION serene_refund_guard();
