-- Shared infrastructure fix (ARCHITECTURE D29, DATABASE_DESIGN "Time zones").
-- One-time correction approved by the product owner on 2026-09-25.
--
-- Until now application sessions ran in the server's default time zone
-- (Asia/Karachi on the development installation). @prisma/adapter-pg sends a
-- JavaScript Date as offset-less UTC wall-clock text, so PostgreSQL stored
-- every application-written timestamp as that wall-clock time *in the session
-- zone* — five hours early for Asia/Karachi — and the adapter shifted it back
-- when reading, which hid the error inside the application while comparisons
-- with SQL now() (idempotency expiry) were off by the offset.
--
-- The application now pins its sessions to UTC (lib/db/prisma.ts). This
-- migration converts the timestamps written before that change to the
-- instants that were meant, once:
--
--   meant = (stored AT TIME ZONE <old session zone>) AT TIME ZONE 'UTC'
--
-- (the exact inverse of the old write path, per row, also across DST).
--
-- Scope: every timestamptz column the application writes through Prisma.
-- Excluded are values PostgreSQL itself produced with now() or a column
-- default, which were always correct:
--   idempotency_keys.created_at, room_type_inventory.updated_at,
--   property_sequences.updated_at;
-- folios.updated_at, written both by the ledger trigger (correct) and by
-- Prisma (shifted), is informational and left as is (rewritten on the next
-- change). Prisma's own _prisma_migrations table is not touched.
--
-- The old session zone is this migration's session zone: migrations run
-- through the Prisma schema engine, whose sessions still use the server
-- default. On a server whose default zone is UTC nothing is changed.
--
-- Append-only ledgers (audit_logs, folio_items, room_status_history,
-- cash_movements, loyalty_transactions, loyalty_membership_changes) and guarded
-- tables reject updates by design. For this one correction their user
-- triggers are disabled per table around the single UPDATE and re-enabled
-- immediately, inside this migration's transaction; the correction is
-- recorded in every organization's audit trail (system.timestamp_correction).

CREATE OR REPLACE FUNCTION serene_legacy_session_timestamp(stored timestamptz, legacy_zone text)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (stored AT TIME ZONE legacy_zone) AT TIME ZONE 'UTC'
$$;

DO $$
DECLARE
  legacy_zone text := current_setting('TimeZone');
  tbl record;
  assignments text;
  affected bigint;
  total bigint := 0;
  corrected jsonb := '{}'::jsonb;
BEGIN
  IF upper(legacy_zone) IN ('UTC', 'ETC/UTC', 'UCT', 'ETC/UCT', 'GMT', 'ETC/GMT', 'GMT0',
                            'ETC/GMT0', 'GREENWICH', 'ZULU', 'ETC/ZULU', 'UNIVERSAL',
                            'ETC/UNIVERSAL') THEN
    RAISE NOTICE 'Sessions already used UTC (%): no timestamp to correct', legacy_zone;
    RETURN;
  END IF;

  FOR tbl IN
    SELECT c.table_name::text AS table_name,
           array_agg(c.column_name::text ORDER BY c.column_name) AS columns
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = current_schema()
      AND c.data_type = 'timestamp with time zone'
      AND c.table_name <> '_prisma_migrations'
      AND (c.table_name::text, c.column_name::text) NOT IN (
        ('idempotency_keys', 'created_at'),
        ('room_type_inventory', 'updated_at'),
        ('property_sequences', 'updated_at'),
        ('folios', 'updated_at'))
    GROUP BY c.table_name
    ORDER BY c.table_name
  LOOP
    SELECT string_agg(
             format('%1$I = serene_legacy_session_timestamp(%1$I, %2$L)', col, legacy_zone),
             ', ')
      INTO assignments
      FROM unnest(tbl.columns) AS col;
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', tbl.table_name);
    EXECUTE format('UPDATE %I SET %s', tbl.table_name, assignments);
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', tbl.table_name);
    IF affected > 0 THEN
      total := total + affected;
      corrected := corrected || jsonb_build_object(tbl.table_name, affected);
    END IF;
  END LOOP;

  INSERT INTO audit_logs
    (id, organization_id, actor_type, action, resource_type, risk, after, reason, created_at)
  SELECT gen_random_uuid(), o.id, 'SYSTEM', 'system.timestamp_correction', 'Database', 'HIGH',
         jsonb_build_object(
           'migration', '20260929090000_utc_session_timestamps',
           'legacySessionZone', legacy_zone,
           'rowsCorrected', total,
           'tables', corrected),
         'Timestamps written while database sessions used the server time zone were converted to the instants they represent; sessions now run in UTC.',
         now()
  FROM organizations o;

  RAISE NOTICE 'Corrected % rows written in session zone %', total, legacy_zone;
END;
$$;
