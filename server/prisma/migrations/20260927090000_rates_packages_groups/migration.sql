-- Phase 6: rate administration, packages and group blocks.
--
-- Rate plans, seasons, restrictions, packages, groups, blocks and block
-- allocations were created in Phase 0. This migration scopes groups to the
-- property they are managed from and adds the integrity rules the
-- administration screens rely on: a derived-rate chain can never loop, nest
-- deeper than the pricing engine resolves, or hang off an inactive or
-- foreign-currency parent; block pickup never exceeds what is held.

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "property_id" UUID;

-- CreateIndex
CREATE INDEX "groups_property_id_status_idx" ON "groups"("property_id", "status");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written rules (Prisma cannot express them; docs/DATABASE_DESIGN.md §5) -----------

ALTER TABLE "block_allocations"
  ADD CONSTRAINT "block_allocations_released_chk" CHECK ("released" <= "allocated");

ALTER TABLE "blocks"
  ADD CONSTRAINT "blocks_cutoff_chk" CHECK ("cutoff_date" IS NULL OR "cutoff_date" <= "end_date");

-- Derived rates: a plan's ancestors (at most 3 derivation steps, which is how
-- far rates.policy.priceNights resolves) plus the depth of its own derived
-- descendants may not exceed 3; no cycles; the parent must be ACTIVE and in
-- the same currency; a plan with ACTIVE derived children cannot be deactivated.
CREATE OR REPLACE FUNCTION serene_rate_plan_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  ancestors int := 0;
  below int := 0;
  cursor_id uuid;
BEGIN
  IF NEW."status" <> 'ACTIVE' AND TG_OP = 'UPDATE' AND OLD."status" = 'ACTIVE' THEN
    IF EXISTS (SELECT 1 FROM "rate_plans"
               WHERE "parent_rate_plan_id" = NEW."id" AND "status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'Rate plan % has active derived plans', NEW."code" USING ERRCODE = 'SM003';
    END IF;
  END IF;

  IF NEW."parent_rate_plan_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "status"::text AS status, "currency_code" INTO parent
    FROM "rate_plans" WHERE "id" = NEW."parent_rate_plan_id";
  IF parent.status IS DISTINCT FROM 'ACTIVE' AND NEW."status" = 'ACTIVE' THEN
    RAISE EXCEPTION 'The parent of rate plan % is not active', NEW."code" USING ERRCODE = 'SM003';
  END IF;
  IF parent.currency_code IS DISTINCT FROM NEW."currency_code" THEN
    RAISE EXCEPTION 'Rate plan % must use its parent''s currency', NEW."code" USING ERRCODE = 'SM003';
  END IF;

  cursor_id := NEW."parent_rate_plan_id";
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW."id" THEN
      RAISE EXCEPTION 'Rate plan % would derive from itself', NEW."code" USING ERRCODE = 'SM003';
    END IF;
    ancestors := ancestors + 1;
    IF ancestors > 3 THEN
      RAISE EXCEPTION 'Rate plan % is derived too deeply (max 3 levels)', NEW."code" USING ERRCODE = 'SM003';
    END IF;
    SELECT "parent_rate_plan_id" INTO cursor_id FROM "rate_plans" WHERE "id" = cursor_id;
  END LOOP;

  WITH RECURSIVE descendants AS (
    SELECT "id", 1 AS depth FROM "rate_plans" WHERE "parent_rate_plan_id" = NEW."id"
    UNION ALL
    SELECT r."id", d.depth + 1 FROM "rate_plans" r JOIN descendants d ON r."parent_rate_plan_id" = d."id"
    WHERE d.depth < 5
  )
  SELECT COALESCE(max(depth), 0) INTO below FROM descendants;
  IF ancestors + below > 3 THEN
    RAISE EXCEPTION 'Rate plan % would make a derived chain deeper than 3 levels', NEW."code" USING ERRCODE = 'SM003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rate_plans_guard"
  BEFORE INSERT OR UPDATE OF "parent_rate_plan_id", "status", "currency_code" ON "rate_plans"
  FOR EACH ROW EXECUTE FUNCTION serene_rate_plan_guard();

-- Block pickup: a non-elastic block never has more rooms picked up for a
-- (room type, night) than it still holds; elastic blocks may pick up beyond
-- their allocation from house inventory.
CREATE OR REPLACE FUNCTION serene_block_allocation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  elastic boolean;
BEGIN
  SELECT "is_elastic" INTO elastic FROM "blocks" WHERE "id" = NEW."block_id";
  IF NOT elastic AND NEW."picked_up" > NEW."allocated" - NEW."released" THEN
    RAISE EXCEPTION 'Block pickup exceeds the allocation on %', NEW."stay_date" USING ERRCODE = 'SM003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "block_allocations_guard"
  BEFORE INSERT OR UPDATE ON "block_allocations"
  FOR EACH ROW EXECUTE FUNCTION serene_block_allocation_guard();
