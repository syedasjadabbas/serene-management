import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/**
 * In-process PostgreSQL (WASM) with every migration applied, for testing the
 * database-level rules (constraints, exclusion constraints, triggers) without
 * a running PostgreSQL server. Service and API integration tests use a real PostgreSQL instead
 * (docs/ARCHITECTURE.md §Testing strategy).
 */
export async function createMigratedDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm, btree_gist } });
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
  }
  return db;
}

/**
 * Runs fixture SQL with foreign keys and triggers disabled, so a test can
 * target one table's rules without building the whole object graph.
 */
export async function withoutReferentialChecks(db: PGlite, sql: string): Promise<void> {
  await db.exec("SET session_replication_role = replica");
  try {
    await db.exec(sql);
  } finally {
    await db.exec("SET session_replication_role = origin");
  }
}

/** Executes SQL and returns the PostgreSQL SQLSTATE it failed with, or undefined. */
export async function sqlStateOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
