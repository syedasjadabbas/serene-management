-- Manual housekeeping tasks (Add task): a short description of the work and an
-- optional target time on the task's business date (property-local "HH:MM").
-- Both nullable: automatic tasks (departure, stayover, carried over) set neither.
ALTER TABLE "housekeeping_tasks" ADD COLUMN "description" VARCHAR(200);
ALTER TABLE "housekeeping_tasks" ADD COLUMN "scheduled_time" VARCHAR(5);

-- Hand-written (Prisma cannot express it; docs/DATABASE_DESIGN.md §5): a 24-hour
-- clock time, so ordering and display never meet "25:00" or "9:5".
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_scheduled_time_check"
  CHECK ("scheduled_time" IS NULL OR "scheduled_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
