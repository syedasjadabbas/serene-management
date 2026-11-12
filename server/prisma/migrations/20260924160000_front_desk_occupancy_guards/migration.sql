-- Phase 3 (front desk): database guards for stays. Documented in
-- docs/DATABASE_DESIGN.md §5; the service layer checks the same rules first.

-- CreateIndex
-- A room holds at most one in-house stay. Together with the room row lock and
-- room_assignments_no_overlap this makes double occupancy impossible even
-- when a departing guest has not yet checked out on the arrival day.
CREATE UNIQUE INDEX "stays_one_in_house_per_room" ON "stays"("property_id", "room_id") WHERE (status = 'IN_HOUSE');

-- Check-out fields are set together, and only on checked-out stays.
ALTER TABLE "stays"
  ADD CONSTRAINT "stays_checkout_chk"
  CHECK ((("status" = 'CHECKED_OUT') = ("checked_out_at" IS NOT NULL))
         AND (("checked_out_at" IS NULL) = ("checked_out_by_id" IS NULL))
         AND (("checked_out_at" IS NULL) = ("departure_business_date" IS NULL))),
  ADD CONSTRAINT "stays_business_dates_chk"
  CHECK ("departure_business_date" IS NULL OR "departure_business_date" >= "arrival_business_date"),
  ADD CONSTRAINT "stays_reinstated_chk" CHECK ("reinstated_count" >= 0);
