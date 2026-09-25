-- Phase 7: guests, companies and loyalty (docs/DATABASE_DESIGN.md §5, Phase 7 notes).
-- Generated DDL first, then the hand-written rules Prisma cannot express.

-- CreateEnum
CREATE TYPE "loyalty_membership_change_type" AS ENUM ('ENROLLED', 'TIER_CHANGED', 'STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "account_contact_kind" AS ENUM ('EMPLOYEE', 'CONTACT', 'ASSOCIATE');

-- AlterTable
ALTER TABLE "account_contacts" ADD COLUMN     "kind" "account_contact_kind" NOT NULL DEFAULT 'CONTACT';

-- AlterTable
ALTER TABLE "account_profiles" ADD COLUMN     "notes" VARCHAR(4000);

-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "phone_digits" VARCHAR(40),
ADD COLUMN     "preferred_contact" "contact_type",
ADD COLUMN     "preferred_name" VARCHAR(100);

-- AlterTable
ALTER TABLE "loyalty_memberships" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "loyalty_tiers" ADD COLUMN     "qualifying_nights" INTEGER,
ADD COLUMN     "qualifying_stays" INTEGER,
ADD COLUMN     "status" "record_status" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "loyalty_membership_changes" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "type" "loyalty_membership_change_type" NOT NULL,
    "from_tier_id" UUID,
    "to_tier_id" UUID,
    "from_status" "record_status",
    "to_status" "record_status",
    "reason" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_membership_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_membership_changes_membership_id_created_at_idx" ON "loyalty_membership_changes"("membership_id", "created_at");

-- CreateIndex
CREATE INDEX "account_contacts_guest_id_idx" ON "account_contacts"("guest_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_contacts_one_primary_key" ON "account_contacts"("account_profile_id") WHERE (is_primary);

-- CreateIndex
CREATE INDEX "guests_phone_digits_trgm_idx" ON "guests" USING GIN ("phone_digits" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_memberships_program_id_guest_id_key" ON "loyalty_memberships"("program_id", "guest_id");

-- AddForeignKey
ALTER TABLE "loyalty_membership_changes" ADD CONSTRAINT "loyalty_membership_changes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "loyalty_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_membership_changes" ADD CONSTRAINT "loyalty_membership_changes_from_tier_id_fkey" FOREIGN KEY ("from_tier_id") REFERENCES "loyalty_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_membership_changes" ADD CONSTRAINT "loyalty_membership_changes_to_tier_id_fkey" FOREIGN KEY ("to_tier_id") REFERENCES "loyalty_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written rules
-- ---------------------------------------------------------------------------

-- Phone search: digits of the primary phone (maintained by the service from now on).
UPDATE "guests"
   SET "phone_digits" = NULLIF(regexp_replace("primary_phone", '\D', '', 'g'), '')
 WHERE "primary_phone" IS NOT NULL;

-- Loyalty points are whole numbers; balances never go negative.
ALTER TABLE "loyalty_memberships"
  ADD CONSTRAINT "loyalty_memberships_points_chk"
  CHECK ("points_balance" >= 0 AND "points_balance" = trunc("points_balance"));

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_points_chk"
  CHECK ("points" <> 0 AND "points" = trunc("points"));

ALTER TABLE "loyalty_tiers"
  ADD CONSTRAINT "loyalty_tiers_qualification_chk"
  CHECK (("qualifying_nights" IS NULL OR "qualifying_nights" >= 0)
     AND ("qualifying_stays" IS NULL OR "qualifying_stays" >= 0));

-- Negotiated-rate validity windows are ordered.
ALTER TABLE "negotiated_rates"
  ADD CONSTRAINT "negotiated_rates_window_chk"
  CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from" <= "valid_to");

-- A membership's tier belongs to the membership's program.
CREATE OR REPLACE FUNCTION serene_loyalty_tier_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tier_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "loyalty_tiers" t WHERE t."id" = NEW."tier_id" AND t."program_id" = NEW."program_id"
  ) THEN
    RAISE EXCEPTION 'Tier % does not belong to program %', NEW."tier_id", NEW."program_id"
      USING ERRCODE = 'SM003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "loyalty_memberships_tier_guard"
  BEFORE INSERT OR UPDATE OF "tier_id", "program_id" ON "loyalty_memberships"
  FOR EACH ROW EXECUTE FUNCTION serene_loyalty_tier_guard();

-- Points ledger and membership history are append-only (corrections are new rows).
CREATE TRIGGER "loyalty_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty_transactions"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "loyalty_membership_changes_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty_membership_changes"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();
