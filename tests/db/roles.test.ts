import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GUARDED_TABLES } from "@/scripts/ops/db-guards";
import { sqlStateOf } from "../support/pglite";

// L8 (docs/ARCHITECTURE.md D51, D53): TRUNCATE guards and the owner/runtime
// role split, with the schema owned and migrated by a non-superuser owner
// role and privileges granted by the real scripts/db/runtime-grants.sql.

const OWNER = "serene_owner";
const RUNTIME = "serene_app";
const ORG = "00000000-0000-7000-8000-000000000001";

let db: PGlite;

async function as<T>(role: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(role ? `SET ROLE ${role}` : "RESET ROLE");
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pg_trgm, btree_gist } });
  await db.exec(`
    CREATE ROLE ${OWNER} NOLOGIN;
    CREATE ROLE ${RUNTIME} NOLOGIN;
    GRANT CREATE ON DATABASE postgres TO ${OWNER};
    GRANT ALL ON SCHEMA public TO ${OWNER};
  `);
  const dir = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  await as(OWNER, async () => {
    // Minimal stand-in for Prisma's migration history table.
    await db.exec(
      `CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, migration_name text)`,
    );
    for (const name of migrations) {
      await db.exec(readFileSync(join(dir, name, "migration.sql"), "utf8"));
    }
    await db.exec(`
      INSERT INTO organizations (id, code, name, base_currency, updated_at)
        VALUES ('${ORG}', 'ORG', 'Org', 'PKR', now());
      INSERT INTO audit_logs (id, organization_id, actor_type, action, resource_type, risk)
        VALUES (gen_random_uuid(), '${ORG}', 'SYSTEM', 'test.seed', 'Test', 'STANDARD');
    `);
  });
  const grants = readFileSync(join(process.cwd(), "scripts", "db", "runtime-grants.sql"), "utf8")
    .replaceAll(':"runtime_role"', `"${RUNTIME}"`)
    .replaceAll(':"owner_role"', `"${OWNER}"`);
  await db.exec(grants);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("TRUNCATE guards (migration 20261101090000_truncate_guards)", () => {
  it("exist as statement-level TRUNCATE triggers on every guarded table", async () => {
    const rows = await db.query<{ table: string }>(
      `SELECT c.relname AS "table" FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (t.tgtype & 32) <> 0 AND (t.tgtype & 1) = 0`,
    );
    expect(rows.rows.map((r) => r.table).sort()).toEqual([...GUARDED_TABLES].sort());
  });

  it("reject TRUNCATE of every guarded table, even by the table owner", async () => {
    for (const table of GUARDED_TABLES) {
      // CASCADE: a plain TRUNCATE of a referenced table (e.g. folios) already
      // fails on its foreign keys; CASCADE is the path that would empty it.
      const state = await as(OWNER, () => sqlStateOf(() => db.exec(`TRUNCATE "${table}" CASCADE`)));
      expect(state, table).toBe("SM001");
    }
  });

  it("also fire when a parent table is truncated with CASCADE", async () => {
    const state = await as(OWNER, () =>
      sqlStateOf(() => db.exec("TRUNCATE organizations CASCADE")),
    );
    expect(state).toBe("SM001");
    const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs");
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("leave transient tables truncatable by the owner", async () => {
    expect(await as(OWNER, () => sqlStateOf(() => db.exec("TRUNCATE idempotency_keys")))).toBe(
      undefined,
    );
  });
});

describe("runtime role (scripts/db/runtime-grants.sql)", () => {
  it("reads and writes application data", async () => {
    await as(RUNTIME, async () => {
      await db.exec(
        `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
         VALUES (gen_random_uuid(), 'Test', 'x', 'test.event', '{}')`,
      );
      const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_events");
      expect(rows.rows[0]!.n).toBeGreaterThan(0);
      await db.exec("DELETE FROM outbox_events WHERE event_type = 'test.event'");
    });
  });

  it("cannot truncate, disable or drop the ledger protections", async () => {
    await as(RUNTIME, async () => {
      expect(await sqlStateOf(() => db.exec("TRUNCATE audit_logs"))).toBe("42501");
      expect(await sqlStateOf(() => db.exec("TRUNCATE idempotency_keys"))).toBe("42501");
      expect(await sqlStateOf(() => db.exec("ALTER TABLE audit_logs DISABLE TRIGGER USER"))).toBe(
        "42501",
      );
      expect(
        await sqlStateOf(() => db.exec(`DROP TRIGGER "audit_logs_append_only" ON audit_logs`)),
      ).toBe("42501");
      expect(await sqlStateOf(() => db.exec("DROP TABLE audit_logs"))).toBe("42501");
      expect(await sqlStateOf(() => db.exec("SET session_replication_role = replica"))).toBe(
        "42501",
      );
      // Row guards still apply to the rows it may otherwise delete.
      expect(await sqlStateOf(() => db.exec("DELETE FROM audit_logs"))).toBe("SM001");
    });
  });

  it("cannot change the schema or the migration history", async () => {
    await as(RUNTIME, async () => {
      expect(await sqlStateOf(() => db.exec("CREATE TABLE intruder (id int)"))).toBe("42501");
      expect(
        await sqlStateOf(() => db.exec(`INSERT INTO "_prisma_migrations" VALUES ('x', 'forged')`)),
      ).toBe("42501");
      const history = await db.query('SELECT count(*) FROM "_prisma_migrations"');
      expect(history.rows).toHaveLength(1);
    });
  });

  it("gets access to tables created by later migrations automatically", async () => {
    await as(OWNER, () => db.exec("CREATE TABLE future_feature (id int PRIMARY KEY)"));
    await as(RUNTIME, async () => {
      await db.exec("INSERT INTO future_feature VALUES (1)");
      const rows = await db.query<{ id: number }>("SELECT id FROM future_feature");
      expect(rows.rows).toEqual([{ id: 1 }]);
    });
  });
});
