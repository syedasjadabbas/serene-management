-- Phase 10 batch 4+5 (H9): the audit-trail report selects a property's rows by business-date range.
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_property_id_business_date_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090300_idx_audit_logs_property_business_date
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "audit_logs_property_id_business_date_idx"
  ON "audit_logs" ("property_id", "business_date");
