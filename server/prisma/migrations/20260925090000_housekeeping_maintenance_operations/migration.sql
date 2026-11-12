-- Phase 4 (housekeeping, rooms, maintenance). Documented in
-- docs/DATABASE_DESIGN.md §5; services check the same rules first.

-- AlterTable
ALTER TABLE "housekeeping_tasks" ADD COLUMN     "completed_by_id" UUID;

-- AlterTable
ALTER TABLE "room_status_history" ADD COLUMN     "reason" VARCHAR(500);

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_attendants_user_key" ON "housekeeping_attendants"("property_id", "user_id") WHERE (user_id IS NOT NULL);

-- Task lifecycle fields follow the status: a cleaned task has a completion
-- time, an inspected task has an inspector and inspection time.
ALTER TABLE "housekeeping_tasks"
  ADD CONSTRAINT "housekeeping_tasks_lifecycle_chk"
  CHECK ((("status" IN ('COMPLETED', 'INSPECTED', 'FAILED_INSPECTION')) <= ("completed_at" IS NOT NULL))
         AND (("status" = 'INSPECTED') = ("inspected_at" IS NOT NULL AND "inspected_by_id" IS NOT NULL))
         AND ("status" <> 'IN_PROGRESS' OR "started_at" IS NOT NULL));

-- Maintenance lifecycle: resolved / closed requests carry their timestamps.
ALTER TABLE "maintenance_requests"
  ADD CONSTRAINT "maintenance_requests_lifecycle_chk"
  CHECK ((("status" IN ('RESOLVED', 'CLOSED')) <= ("resolved_at" IS NOT NULL))
         AND (("status" = 'CLOSED') = ("closed_at" IS NOT NULL))
         AND ("status" <> 'ASSIGNED' OR "assigned_to_id" IS NOT NULL));
