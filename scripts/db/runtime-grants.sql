-- SERENE MANAGEMENT: privileges of the runtime (application) role — D53,
-- docs/OPERATIONS.md §4. Plain SQL with two psql variables:
--   :"owner_role"    role that owns the schema and runs migrations
--   :"runtime_role"  role the application connects as (DATABASE_URL)
-- Included by runtime-role.sql; also executed by tests/db/roles.test.ts.
-- Idempotent. Run it in the application database, as the owner or a superuser.
--
-- The runtime role gets data access only: no ownership (so it cannot ALTER,
-- DROP or DISABLE TRIGGER), no TRUNCATE, no DDL, and read-only access to
-- the migration history.

GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
REVOKE INSERT, UPDATE, DELETE ON TABLE public."_prisma_migrations" FROM :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";

-- Tables and sequences created by future migrations (run as the owner).
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

-- Session defaults for connections that cannot send startup options (e.g.
-- through a transaction-pooling PgBouncer). The application also sets them
-- per connection (lib/db/pool-config.ts), which takes precedence.
ALTER ROLE :"runtime_role" SET "TimeZone" = 'UTC';
ALTER ROLE :"runtime_role" SET statement_timeout = '30s';
ALTER ROLE :"runtime_role" SET idle_in_transaction_session_timeout = '60s';
