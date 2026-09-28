-- Phase 10 batch 4+5 (H9): nights not yet posted (night-audit readiness and posting): a small partial
-- index instead of walking every night of the property's history.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "reservation_room_nights_unposted_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090500_idx_reservation_room_nights_unposted
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "reservation_room_nights_unposted_idx"
  ON "reservation_room_nights" ("property_id", "stay_date") WHERE "posted_at" IS NULL;
