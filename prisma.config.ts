import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, env } from "prisma/config";

// Load .env when present without overriding the real environment. Node's own
// parser: `prisma migrate deploy` must work in a production install that has
// no development dependencies (H11, docs/DEPLOYMENT.md).
if (existsSync(".env")) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(".env", "utf8")))) {
    process.env[key] ??= value;
  }
}

const migrationUrlVariable = process.env.MIGRATION_DATABASE_URL
  ? "MIGRATION_DATABASE_URL"
  : process.env.DATABASE_URL
    ? "DATABASE_URL"
    : undefined;

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    // Development seed (needs tsx). Production uses `npm run ops:seed`.
    seed: "node --conditions=react-server --import tsx prisma/seed/index.ts",
  },
  // Only migrate/introspection need the database. Client generation (the
  // postinstall step) must work without credentials, e.g. on a build host.
  // Migrations connect as the schema owner (MIGRATION_DATABASE_URL) when the
  // runtime uses a separate, non-owner role (docs/OPERATIONS.md §4).
  ...(migrationUrlVariable ? { datasource: { url: env(migrationUrlVariable) } } : {}),
});
