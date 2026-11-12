-- Phase 9: multi-property operations + integration foundation
-- (docs/ARCHITECTURE.md D35-D40, DATABASE_DESIGN.md §5 "Phase 9").

-- ---------------------------------------------------------------------------
-- Confirmation prefixes (D36)
-- ---------------------------------------------------------------------------
-- Every property prefixes its new confirmation numbers ("SMR-100045"), so two
-- properties of one organization never issue the same confirmation. The
-- prefix defaults to the property code (codes are unique per organization and
-- follow the same pattern), and existing confirmation numbers are unchanged.

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "confirmation_prefix" VARCHAR(10);

UPDATE "properties" SET "confirmation_prefix" = upper("code");

ALTER TABLE "properties" ALTER COLUMN "confirmation_prefix" SET NOT NULL;

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_confirmation_prefix_chk"
    CHECK ("confirmation_prefix" ~ '^[A-Z][A-Z0-9]{1,9}$');

-- CreateIndex
CREATE UNIQUE INDEX "properties_organization_id_confirmation_prefix_key" ON "properties"("organization_id", "confirmation_prefix");

-- ---------------------------------------------------------------------------
-- Audit history of organization data (G5)
-- ---------------------------------------------------------------------------
-- Guest and company history and the organization audit trail filter by
-- organization and resource: the existing indexes lead with property,
-- resource type or user and cannot serve them.

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_resource_id_created_at_idx" ON "audit_logs"("organization_id", "resource_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Groups are managed from a property (D5)
-- ---------------------------------------------------------------------------
-- Since Phase 6 every group is created from a property; a group without a
-- property is invisible on every route. Existing legacy rows are kept as
-- they are (NOT VALID skips them); new and updated rows must name a property.

ALTER TABLE "groups"
  ADD CONSTRAINT "groups_property_required_chk" CHECK ("property_id" IS NOT NULL) NOT VALID;
