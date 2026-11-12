-- Phase 10 batch 4+5 (H9): a program's member list pages newest enrolment first.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "loyalty_memberships_program_id_enrolled_at_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090700_idx_loyalty_memberships_program_enrolled
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "loyalty_memberships_program_id_enrolled_at_idx"
  ON "loyalty_memberships" ("program_id", "enrolled_at" DESC, "id" DESC);
