-- Phase 10 batch 4+5 (H9): today's arrivals, walk-ins and day-use rooms (front desk, dashboard, night audit).
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "stays_property_id_arrival_business_date_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090400_idx_stays_property_arrival
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "stays_property_id_arrival_business_date_idx"
  ON "stays" ("property_id", "arrival_business_date");
