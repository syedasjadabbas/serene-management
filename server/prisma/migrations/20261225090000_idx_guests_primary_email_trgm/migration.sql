-- Guest search by part of an e-mail address ("ahmed.almansoori", "@example.com"):
-- a contains match on guests.primary_email, which the (organization_id,
-- primary_email) btree cannot serve. pg_trgm is installed by the init migration.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "guests_primary_email_trgm_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261225090000_idx_guests_primary_email_trgm
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "guests_primary_email_trgm_idx"
  ON "guests" USING gin ("primary_email" gin_trgm_ops);
