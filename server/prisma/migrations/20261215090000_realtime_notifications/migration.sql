-- Realtime change notifications (docs/SCALABILITY.md §31, ARCHITECTURE D63).
--
-- Screens that polled every 60 s subscribe to a server-sent event stream
-- instead. Changes are announced with PostgreSQL NOTIFY from the writing
-- transaction itself, so every application instance (each LISTENs on one
-- dedicated connection) hears every change, whichever instance or job made
-- it, and only once it commits (NOTIFY is transactional; a rollback sends
-- nothing). Identical notifications of one transaction are delivered once.
--
-- A notification carries no row data: the property, the changed topics and
-- the transaction id. Clients refetch through the normal, authorized API.

-- Operational changes: 'serene_changes' {p: property, t: "topic,topic", x: txid}.
CREATE OR REPLACE FUNCTION serene_notify_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  property uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    property := OLD.property_id;
  ELSE
    property := NEW.property_id;
  END IF;
  IF property IS NOT NULL THEN
    PERFORM pg_notify(
      'serene_changes',
      json_build_object('p', property, 't', TG_ARGV[0], 'x', txid_current()::text)::text
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "reservation_rooms_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "reservation_rooms"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk,rooms');
CREATE TRIGGER "stays_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "stays"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk,rooms');
CREATE TRIGGER "reservations_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk');
CREATE TRIGGER "reservation_notes_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "reservation_notes"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk');
CREATE TRIGGER "room_assignments_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "room_assignments"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk,rooms');
CREATE TRIGGER "rooms_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "rooms"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk,rooms,housekeeping');
CREATE TRIGGER "room_service_blocks_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "room_service_blocks"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('frontdesk,rooms,housekeeping');
CREATE TRIGGER "housekeeping_tasks_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "housekeeping_tasks"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('rooms,housekeeping');
CREATE TRIGGER "maintenance_requests_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "maintenance_requests"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('rooms');
CREATE TRIGGER "business_dates_notify_change"
  AFTER INSERT OR UPDATE OR DELETE ON "business_dates"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_change('businessdate,frontdesk,rooms,housekeeping');

-- Access changes: 'serene_access' {s: session} | {u: user} | {o: organization} | {p: property}.
-- Open streams of the affected sessions are closed at once; their clients
-- reconnect and are authenticated again (a revoked session gets 401).
CREATE OR REPLACE FUNCTION serene_notify_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data record;
  organization uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := OLD;
  ELSE
    row_data := NEW;
  END IF;
  IF TG_TABLE_NAME = 'auth_sessions' THEN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      PERFORM pg_notify('serene_access', json_build_object('s', NEW.id)::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'users' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at THEN
      PERFORM pg_notify('serene_access', json_build_object('u', NEW.id)::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'user_role_assignments' THEN
    PERFORM pg_notify('serene_access', json_build_object('u', row_data.user_id)::text);
    IF TG_OP = 'UPDATE' THEN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        PERFORM pg_notify('serene_access', json_build_object('u', OLD.user_id)::text);
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'role_permissions' THEN
    SELECT r.organization_id INTO organization FROM roles r WHERE r.id = row_data.role_id;
    -- A role without an organization is a template: every organization may use it.
    PERFORM pg_notify(
      'serene_access',
      CASE WHEN organization IS NULL THEN '{"all":true}'
           ELSE json_build_object('o', organization)::text END
    );
  ELSIF TG_TABLE_NAME = 'properties' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM pg_notify('serene_access', json_build_object('p', NEW.id)::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'organizations' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM pg_notify('serene_access', json_build_object('o', NEW.id)::text);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "auth_sessions_notify_access"
  AFTER UPDATE ON "auth_sessions"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_access();
CREATE TRIGGER "users_notify_access"
  AFTER UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_access();
CREATE TRIGGER "user_role_assignments_notify_access"
  AFTER INSERT OR UPDATE OR DELETE ON "user_role_assignments"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_access();
CREATE TRIGGER "role_permissions_notify_access"
  AFTER INSERT OR UPDATE OR DELETE ON "role_permissions"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_access();
CREATE TRIGGER "properties_notify_access"
  AFTER UPDATE ON "properties"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_access();
CREATE TRIGGER "organizations_notify_access"
  AFTER UPDATE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_access();
