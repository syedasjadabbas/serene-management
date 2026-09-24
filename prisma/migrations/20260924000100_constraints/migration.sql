-- SERENE MANAGEMENT — integrity rules Prisma cannot express.
-- Hand-written. Every rule here is documented in docs/DATABASE_DESIGN.md.
-- The service layer validates the same rules first and returns a friendly
-- error; these constraints are the last line of defence against bugs,
-- races and manual SQL.

-- ---------------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_check_in_time_chk"  CHECK ("check_in_time"  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "properties_check_out_time_chk" CHECK ("check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "property_configurations"
  ADD CONSTRAINT "property_configurations_windows_chk" CHECK ("max_folio_windows" BETWEEN 1 AND 99);

ALTER TABLE "business_dates"
  ADD CONSTRAINT "business_dates_current_chk" CHECK ("is_current" = ("status" <> 'CLOSED'));

ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_rate_chk" CHECK ("rate" > 0);

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_scope_chk" CHECK (("scope" = 'PROPERTY') = ("property_id" IS NOT NULL));

-- Rooms ---------------------------------------------------------------------

ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_occupancy_chk"
  CHECK ("max_occupancy" >= 1 AND "max_adults" >= 1 AND "max_children" >= 0
         AND "default_occupancy" BETWEEN 1 AND "max_occupancy");

ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_hk_persons_chk" CHECK ("hk_reported_persons" IS NULL OR "hk_reported_persons" >= 0);

ALTER TABLE "room_connections"
  ADD CONSTRAINT "room_connections_order_chk" CHECK ("room_a_id" < "room_b_id");

ALTER TABLE "room_components"
  ADD CONSTRAINT "room_components_self_chk" CHECK ("suite_room_id" <> "component_room_id");

ALTER TABLE "room_service_blocks"
  ADD CONSTRAINT "room_service_blocks_dates_chk" CHECK ("to_date" > "from_date");

ALTER TABLE "room_holds"
  ADD CONSTRAINT "room_holds_dates_chk" CHECK ("to_date" >= "from_date");

-- Inventory & rates -----------------------------------------------------------

ALTER TABLE "room_type_inventory"
  ADD CONSTRAINT "room_type_inventory_counts_chk"
  CHECK ("physical_rooms" >= 0 AND "out_of_order" >= 0 AND "sold" >= 0 AND "blocked" >= 0
         AND "overbook_limit" >= 0 AND ("sell_limit" IS NULL OR "sell_limit" >= 0));

ALTER TABLE "house_inventory_controls"
  ADD CONSTRAINT "house_inventory_controls_chk"
  CHECK ("overbook_limit" >= 0 AND ("sell_limit" IS NULL OR "sell_limit" >= 0));

ALTER TABLE "restrictions"
  ADD CONSTRAINT "restrictions_value_chk"
  CHECK (("type" IN ('CLOSED', 'CLOSED_TO_ARRIVAL', 'CLOSED_TO_DEPARTURE')) = ("value" IS NULL)
         AND ("value" IS NULL OR "value" >= 0));

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_derivation_chk"
  CHECK (("parent_rate_plan_id" IS NULL) = ("derivation_type" IS NULL)
         AND ("derivation_type" IS NULL) = ("derivation_value" IS NULL)),
  ADD CONSTRAINT "rate_plans_parent_self_chk" CHECK ("parent_rate_plan_id" IS NULL OR "parent_rate_plan_id" <> "id"),
  ADD CONSTRAINT "rate_plans_sell_window_chk" CHECK ("sell_to" IS NULL OR "sell_from" IS NULL OR "sell_to" >= "sell_from"),
  ADD CONSTRAINT "rate_plans_stay_window_chk" CHECK ("stay_to" IS NULL OR "stay_from" IS NULL OR "stay_to" >= "stay_from");

ALTER TABLE "rate_seasons"
  ADD CONSTRAINT "rate_seasons_dates_chk" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "rate_seasons_dow_chk" CHECK ("days_of_week" BETWEEN 1 AND 127);

ALTER TABLE "rate_season_amounts"
  ADD CONSTRAINT "rate_season_amounts_chk"
  CHECK ("one_adult" >= 0 AND COALESCE("two_adults", 0) >= 0 AND COALESCE("three_adults", 0) >= 0
         AND COALESCE("four_adults", 0) >= 0 AND COALESCE("extra_adult", 0) >= 0
         AND COALESCE("extra_child", 0) >= 0);

ALTER TABLE "package_components"
  ADD CONSTRAINT "package_components_price_chk" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "package_components_dow_chk" CHECK ("days_of_week" BETWEEN 1 AND 127);

ALTER TABLE "package_component_prices"
  ADD CONSTRAINT "package_component_prices_chk" CHECK ("end_date" >= "start_date" AND "unit_price" >= 0);

ALTER TABLE "cancellation_policies"
  ADD CONSTRAINT "cancellation_policies_chk" CHECK ("deadline_hours" >= 0 AND "penalty_value" >= 0);

ALTER TABLE "deposit_policies"
  ADD CONSTRAINT "deposit_policies_chk" CHECK ("amount_value" >= 0 AND "due_days" >= 0);

-- Reservations ----------------------------------------------------------------

ALTER TABLE "reservation_rooms"
  ADD CONSTRAINT "reservation_rooms_dates_chk" CHECK ("departure_date" >= "arrival_date"),
  ADD CONSTRAINT "reservation_rooms_day_use_chk" CHECK ("is_day_use" = ("departure_date" = "arrival_date")),
  ADD CONSTRAINT "reservation_rooms_party_chk" CHECK ("adults" >= 1 AND "children" >= 0),
  ADD CONSTRAINT "reservation_rooms_line_chk" CHECK ("line_number" >= 1),
  ADD CONSTRAINT "reservation_rooms_discount_chk"
  CHECK (("discount_amount" IS NULL OR "discount_amount" >= 0)
         AND ("discount_percent" IS NULL OR "discount_percent" BETWEEN 0 AND 100)),
  ADD CONSTRAINT "reservation_rooms_cancel_chk"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)),
  ADD CONSTRAINT "reservation_rooms_no_show_chk"
  CHECK (("status" = 'NO_SHOW') = ("no_show_at" IS NOT NULL));

ALTER TABLE "reservation_room_nights"
  ADD CONSTRAINT "reservation_room_nights_chk" CHECK ("rate_amount" >= 0 AND "adults" >= 1 AND "children" >= 0);

ALTER TABLE "reservation_packages"
  ADD CONSTRAINT "reservation_packages_chk" CHECK ("quantity" >= 1 AND "end_date" >= "start_date");

ALTER TABLE "fixed_charges"
  ADD CONSTRAINT "fixed_charges_chk"
  CHECK ("quantity" >= 1 AND "end_date" >= "start_date"
         AND ("day_of_week" IS NULL OR "day_of_week" BETWEEN 1 AND 7)
         AND ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 31));

ALTER TABLE "room_assignments"
  ADD CONSTRAINT "room_assignments_dates_chk" CHECK ("to_date" >= "from_date");

ALTER TABLE "deposit_requests"
  ADD CONSTRAINT "deposit_requests_chk" CHECK ("amount" > 0 AND "paid_amount" >= 0);

ALTER TABLE "turnaways"
  ADD CONSTRAINT "turnaways_chk" CHECK ("nights" >= 0 AND "rooms" >= 1 AND "adults" >= 1);

-- Groups ----------------------------------------------------------------------

ALTER TABLE "blocks"
  ADD CONSTRAINT "blocks_dates_chk" CHECK ("end_date" > "start_date"),
  ADD CONSTRAINT "blocks_cutoff_days_chk" CHECK ("cutoff_days" IS NULL OR "cutoff_days" >= 0);

ALTER TABLE "block_allocations"
  ADD CONSTRAINT "block_allocations_chk" CHECK ("allocated" >= 0 AND "picked_up" >= 0 AND "released" >= 0);

-- Billing ---------------------------------------------------------------------

ALTER TABLE "folios"
  ADD CONSTRAINT "folios_window_chk" CHECK ("window" >= 1),
  ADD CONSTRAINT "folios_owner_guest_chk" CHECK (("owner_type" = 'GUEST') = ("reservation_room_id" IS NOT NULL)),
  ADD CONSTRAINT "folios_owner_group_chk" CHECK (("owner_type" = 'GROUP_MASTER') = ("block_id" IS NOT NULL)),
  ADD CONSTRAINT "folios_balance_chk" CHECK ("balance" = "charges_total" + "credits_total");

ALTER TABLE "folio_items"
  ADD CONSTRAINT "folio_items_quantity_chk" CHECK ("quantity" <> 0),
  ADD CONSTRAINT "folio_items_correction_chk"
  CHECK ("kind" NOT IN ('REVERSAL', 'ADJUSTMENT') OR "corrects_item_id" IS NOT NULL),
  ADD CONSTRAINT "folio_items_transfer_chk"
  CHECK ("kind" NOT IN ('TRANSFER_IN', 'TRANSFER_OUT') OR "transfer_id" IS NOT NULL),
  ADD CONSTRAINT "folio_items_tax_parent_chk" CHECK ("kind" <> 'TAX' OR "parent_item_id" IS NOT NULL),
  ADD CONSTRAINT "folio_items_payment_chk" CHECK ("kind" <> 'PAYMENT' OR "payment_id" IS NOT NULL OR "refund_id" IS NOT NULL),
  ADD CONSTRAINT "folio_items_fx_chk"
  CHECK (("original_currency" IS NULL) = ("original_amount" IS NULL)
         AND ("original_currency" IS NULL) = ("exchange_rate" IS NULL));

ALTER TABLE "routing_instructions"
  ADD CONSTRAINT "routing_instructions_target_chk"
  CHECK (("target_kind" = 'WINDOW' AND "target_window" IS NOT NULL)
      OR ("target_kind" = 'RESERVATION_ROOM' AND "target_reservation_room_id" IS NOT NULL)
      OR ("target_kind" = 'FOLIO' AND "target_folio_id" IS NOT NULL)),
  ADD CONSTRAINT "routing_instructions_dates_chk" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "routing_instructions_limit_chk" CHECK ("limit_amount" IS NULL OR "limit_amount" > 0);

ALTER TABLE "tax_rules"
  ADD CONSTRAINT "tax_rules_chk" CHECK ("rate" >= 0 AND ("effective_to" IS NULL OR "effective_to" >= "effective_from"));

-- Payments --------------------------------------------------------------------

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_refunded_chk" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount"),
  ADD CONSTRAINT "payments_deposit_chk" CHECK ("kind" <> 'DEPOSIT' OR "reservation_id" IS NOT NULL),
  ADD CONSTRAINT "payments_card_last4_chk" CHECK ("card_last4" IS NULL OR "card_last4" ~ '^[0-9]{4}$');

ALTER TABLE "payment_instruments"
  ADD CONSTRAINT "payment_instruments_last4_chk" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "payment_instruments_owner_chk" CHECK ("guest_id" IS NOT NULL OR "account_profile_id" IS NOT NULL);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_chk" CHECK ("amount" > 0);

ALTER TABLE "card_authorizations"
  ADD CONSTRAINT "card_authorizations_amount_chk" CHECK ("amount" > 0);

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_amount_chk" CHECK ("amount" <> 0);

ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_float_chk" CHECK ("opening_float" >= 0),
  ADD CONSTRAINT "cashier_shifts_closed_chk" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));

-- Operations / commercial -----------------------------------------------------

ALTER TABLE "housekeeping_tasks"
  ADD CONSTRAINT "housekeeping_tasks_chk" CHECK ("priority" >= 0 AND "credits" >= 0);

ALTER TABLE "maintenance_requests"
  ADD CONSTRAINT "maintenance_requests_location_chk" CHECK ("room_id" IS NOT NULL OR "location" IS NOT NULL);

ALTER TABLE "preventive_maintenance_plans"
  ADD CONSTRAINT "preventive_maintenance_plans_chk" CHECK ("interval_days" >= 1);

ALTER TABLE "commissions"
  ADD CONSTRAINT "commissions_chk" CHECK ("amount" >= 0 AND "basis_amount" >= 0);

-- ---------------------------------------------------------------------------
-- 2. Exclusion constraints (btree_gist)
-- ---------------------------------------------------------------------------

-- Never two active assignments of one room for overlapping nights, unless the
-- reservation rooms share the room (same occupancy_key). Day use (to = from)
-- occupies its single calendar day.
ALTER TABLE "room_assignments"
  ADD CONSTRAINT "room_assignments_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("from_date", CASE WHEN "to_date" > "from_date" THEN "to_date" ELSE "from_date" + 1 END, '[)') WITH &&,
    "occupancy_key" WITH <>
  ) WHERE ("status" = 'ACTIVE');

-- A room has at most one live out-of-order / out-of-service period per night.
ALTER TABLE "room_service_blocks"
  ADD CONSTRAINT "room_service_blocks_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("from_date", "to_date", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE'));

-- A room can be held by only one active hold per night.
ALTER TABLE "room_holds"
  ADD CONSTRAINT "room_holds_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("from_date", CASE WHEN "to_date" > "from_date" THEN "to_date" ELSE "from_date" + 1 END, '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');

-- ---------------------------------------------------------------------------
-- 3. Append-only and immutability triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION serene_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'SM001';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "folio_items_append_only"
  BEFORE UPDATE OR DELETE ON "folio_items"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "room_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "room_status_history"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

CREATE TRIGGER "cash_movements_append_only"
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION serene_reject_mutation();

-- Invoices are immutable fiscal documents: only ISSUED -> CREDITED is allowed.
CREATE OR REPLACE FUNCTION serene_invoice_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted' USING ERRCODE = 'SM001';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
     OR NOT (OLD."status" = 'ISSUED' AND NEW."status" IN ('ISSUED', 'CREDITED')) THEN
    RAISE EXCEPTION 'Invoice % is immutable', OLD."invoice_number" USING ERRCODE = 'SM001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_immutable"
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION serene_invoice_guard();

-- Closed business dates are frozen.
CREATE OR REPLACE FUNCTION serene_business_date_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Business dates cannot be deleted' USING ERRCODE = 'SM001';
  END IF;
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'Business date % is closed', OLD."date" USING ERRCODE = 'SM001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "business_dates_guard"
  BEFORE UPDATE OR DELETE ON "business_dates"
  FOR EACH ROW EXECUTE FUNCTION serene_business_date_guard();

-- No postings into a CLOSED folio.
CREATE OR REPLACE FUNCTION serene_folio_item_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  folio_status text;
BEGIN
  SELECT "status"::text INTO folio_status FROM "folios" WHERE "id" = NEW."folio_id";
  IF folio_status = 'CLOSED' THEN
    RAISE EXCEPTION 'Folio % is closed', NEW."folio_id" USING ERRCODE = 'SM002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "folio_items_open_folio_only"
  BEFORE INSERT ON "folio_items"
  FOR EACH ROW EXECUTE FUNCTION serene_folio_item_insert_guard();
