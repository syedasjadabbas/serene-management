-- Phase 10 batch 4+5 (H9): the ledger line of a payment, read on every void and refund and by night-audit
-- readiness (partial: only payment lines carry a payment_id).
--
-- Built with CREATE INDEX CONCURRENTLY so writes to the table continue while
-- it builds. Alone in its migration file and without BEGIN/COMMIT: CONCURRENTLY
-- cannot run inside a transaction block (docs/OPERATIONS.md §3.3).
--
-- If this migration fails, the build may leave an INVALID index behind:
--   DROP INDEX CONCURRENTLY IF EXISTS "folio_items_payment_id_idx";
--   node node_modules/prisma/build/index.js migrate resolve --rolled-back 20261110090000_idx_folio_items_payment_id
-- then deploy again (docs/OPERATIONS.md §3.4).

CREATE INDEX CONCURRENTLY "folio_items_payment_id_idx"
  ON "folio_items" ("payment_id") WHERE "payment_id" IS NOT NULL;
