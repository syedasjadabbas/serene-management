-- Scalability phase (docs/SCALABILITY.md §7): live housekeeping tasks per room.
--
-- The room board (polled every 60 s, and run inside every front-desk summary) finds
-- each room's current task among open tasks and today's completed one. The only
-- (property_id, room_id) index also holds every historical task, so each of the
-- property's rooms walked its whole task history: on a 300-room property with
-- ~220 past tasks per room that was 34 000 of the board's 38 000 buffer reads
-- (47 ms per board). Only open and completed-not-inspected tasks are indexed here;
-- inspected, skipped and cancelled history is not. The awaiting-inspection count
-- (status COMPLETED) is served by the same index.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while it
-- builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY cannot
-- run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "housekeeping_tasks_live_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261130090000_idx_housekeeping_tasks_live
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "housekeeping_tasks_live_idx"
  ON "housekeeping_tasks" ("property_id", "room_id")
  WHERE "status" IN ('PENDING', 'IN_PROGRESS', 'PAUSED', 'FAILED_INSPECTION', 'COMPLETED');
