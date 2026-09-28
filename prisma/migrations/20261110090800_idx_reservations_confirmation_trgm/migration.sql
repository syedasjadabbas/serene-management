-- Phase 10 batch 4+5 (H9): confirmation search uses prefix, contains ('-10003') and ends-with
-- matches; a btree serves none of the last two (and prefixes only under the C
-- collation). pg_trgm is installed by the init migration.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "reservations_confirmation_number_trgm_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090800_idx_reservations_confirmation_trgm
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "reservations_confirmation_number_trgm_idx"
  ON "reservations" USING gin ("confirmation_number" gin_trgm_ops);
