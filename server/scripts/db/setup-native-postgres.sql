-- SERENE MANAGEMENT: development database bootstrap for a native PostgreSQL
-- installation. Run as a superuser via scripts/db/setup-native-postgres.ps1.
-- Idempotent: safe to run again (it also resets the app role's password to
-- the one in .env).
--
-- Inputs (psql variables / environment):
--   :app_user, :app_db, :test_db       set with -v by the PowerShell script
--   SERENE_DB_PASSWORD                  environment variable (never on the command line)

\set ON_ERROR_STOP on
\getenv app_password SERENE_DB_PASSWORD

-- Application role: owns its databases, may create the test database, is not
-- a superuser. pg_trgm and btree_gist are trusted extensions, so the owner can
-- create them from the Prisma migrations.
SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format('ALTER ROLE %I WITH LOGIN CREATEDB NOSUPERUSER PASSWORD %L', :'app_user', :'app_password') \gexec

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', :'app_db', :'app_user', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db') \gexec

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', :'test_db', :'app_user', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'test_db') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'test_db') \gexec

SELECT rolname AS role, rolcanlogin AS can_login, rolcreatedb AS can_create_db, rolsuper AS superuser
FROM pg_roles WHERE rolname = :'app_user';
SELECT datname AS database, pg_get_userbyid(datdba) AS owner
FROM pg_database WHERE datname IN (:'app_db', :'test_db') ORDER BY datname;
