-- SERENE MANAGEMENT: create or update the runtime (application) role and its
-- privileges — D53, docs/OPERATIONS.md §4. Production and staging; the
-- development setup keeps a single owner role (npm run db:setup).
--
-- Run as a superuser (or a role with CREATEROLE that may also grant on the
-- owner's objects), after `npm run db:deploy`:
--
--   SERENE_RUNTIME_PASSWORD='<strong password>' psql -h HOST -U postgres -d postgres -X \
--     -v owner_role=serene -v runtime_role=serene_app -v app_db=serene_management \
--     -f scripts/db/runtime-role.sql
--
-- The password comes from the environment, never the command line. Idempotent:
-- re-running resets the password and re-applies the grants.

\set ON_ERROR_STOP on
\getenv runtime_password SERENE_RUNTIME_PASSWORD
\if :{?runtime_password}
  SELECT length(:'runtime_password') >= 16 AS password_ok \gset
\else
  \set password_ok false
\endif
\if :password_ok
\else
  \warn 'SERENE_RUNTIME_PASSWORD must be set (16+ characters). Nothing was changed.'
  SELECT 1 / 0 AS aborted;
\endif

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
              :'runtime_role', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role') \gexec

SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
              :'runtime_role', :'runtime_password') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'app_db', :'runtime_role') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db') \gexec

\connect :"app_db"
\ir runtime-grants.sql

SELECT :'runtime_role' AS runtime_role,
       count(*) FILTER (WHERE tableowner = :'runtime_role') AS tables_owned_by_runtime,
       count(*) AS tables
FROM pg_tables WHERE schemaname = 'public';
