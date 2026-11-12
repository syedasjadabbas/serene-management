-- Phase 10 batch 4+5 (H9): the organization audit trail pages newest first (keyset on created_at, id).
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_organization_id_created_at_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090200_idx_audit_logs_organization_created
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "audit_logs_organization_id_created_at_idx"
  ON "audit_logs" ("organization_id", "created_at" DESC, "id" DESC);
