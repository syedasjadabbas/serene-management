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

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    // Development seed (needs tsx). Production uses `npm run ops:seed`.
    seed: "node --conditions=react-server --import tsx prisma/seed/index.ts",
  },
  // Only migrate/introspection need the database. Client generation (the
  // postinstall step) must work without credentials, e.g. on a build host.
  ...(process.env.DATABASE_URL ? { datasource: { url: env("DATABASE_URL") } } : {}),
});
