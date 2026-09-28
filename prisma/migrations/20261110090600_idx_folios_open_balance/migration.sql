-- Phase 10 batch 4+5 (H9): folios with a non-zero balance (open-balance totals and the open-balance
-- folio list).
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "folios_open_balance_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090600_idx_folios_open_balance
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "folios_open_balance_idx"
  ON "folios" ("property_id", "reservation_room_id") WHERE "balance" <> 0;
