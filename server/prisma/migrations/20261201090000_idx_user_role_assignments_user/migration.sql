-- Scalability phase 2 (docs/SCALABILITY.md §25): role assignments by user.
--
-- Every authenticated request reads the caller's role grants by user_id. The only
-- indexes on user_role_assignments starting with user_id are the two PARTIAL unique
-- indexes (property grants: property_id IS NOT NULL; organization grants: property_id
-- IS NULL), which a lookup by user_id alone cannot use, so PostgreSQL scanned every
-- assignment of every organization on each request. Measured on the benchmark
-- database with 100 000 assignments: 8.7 ms execution per authentication without
-- this index, 0.5 ms with it.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while it
-- builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY cannot
-- run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "user_role_assignments_user_id_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261201090000_idx_user_role_assignments_user
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "user_role_assignments_user_id_idx"
  ON "user_role_assignments" ("user_id");
