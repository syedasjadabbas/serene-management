import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  backupFileName,
  checksumLine,
  findPgProgram,
  libpqEnv,
  parseChecksumLine,
  parseConnection,
  redact,
  restoreProblems,
  withDatabase,
} from "@/scripts/ops/backup-lib";

const URL_WITH_SECRET =
  "postgresql://serene:Pa%24%24-w0rd-XYZ@db.internal:6543/serene_management?sslmode=require";

describe("backup helpers (H7)", () => {
  it("parses the connection and keeps the password out of the arguments", () => {
    const connection = parseConnection(URL_WITH_SECRET);
    expect(connection).toMatchObject({
      host: "db.internal",
      port: "6543",
      user: "serene",
      database: "serene_management",
      sslmode: "require",
    });
    const env = libpqEnv(connection, "restore_target");
    expect(env).toEqual({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGUSER: "serene",
      PGPASSWORD: "Pa$$-w0rd-XYZ",
      PGDATABASE: "restore_target",
      PGSSLMODE: "require",
    });
    expect(withDatabase(URL_WITH_SECRET, "postgres")).toContain("/postgres?");
    expect(() => parseConnection("mysql://x@y/z")).toThrow();
    expect(() => parseConnection("postgresql://x@y/")).toThrow();
  });

  it("names backups by database and UTC time, sortably", () => {
    expect(backupFileName("serene_management", new Date("2026-11-02T03:04:05.678Z"))).toBe(
      "serene_management_20261102T030405Z.dump",
    );
    const hex = "a".repeat(64);
    expect(parseChecksumLine(checksumLine(hex, "x.dump"))).toBe(hex);
    expect(parseChecksumLine("not a checksum")).toBeNull();
  });

  it("refuses restores that are not explicitly confirmed or would overwrite live data", () => {
    const ok = {
      file: "b.dump",
      targetDb: "serene_restore_drill",
      confirmTarget: "serene_restore_drill",
      liveDatabases: ["serene_management"],
    };
    expect(restoreProblems(ok)).toEqual([]);
    expect(restoreProblems({ ...ok, file: undefined })[0]).toMatch(/--file/);
    expect(restoreProblems({ ...ok, targetDb: undefined })[0]).toMatch(/--target-db/);
    expect(restoreProblems({ ...ok, confirmTarget: undefined })[0]).toMatch(/--confirm-target/);
    expect(restoreProblems({ ...ok, confirmTarget: "serene_restore" })[0]).toMatch(
      /--confirm-target/,
    );
    expect(
      restoreProblems({ ...ok, targetDb: "serene_management", confirmTarget: "serene_management" }),
    ).toEqual([
      expect.stringMatching(/Refusing to restore into the database the application uses/),
    ]);
    for (const bad of ['x"; DROP DATABASE y; --', "Upper", "1abc", "a".repeat(64)]) {
      expect(restoreProblems({ ...ok, targetDb: bad, confirmTarget: bad }).length).toBeGreaterThan(
        0,
      );
    }
  });

  it("redacts secrets from tool output", () => {
    expect(redact("connect to db failed for Pa$$-w0rd-XYZ", ["Pa$$-w0rd-XYZ", ""])).toBe(
      "connect to db failed for ***",
    );
  });

  describe("locating pg_dump / pg_restore", () => {
    const root = mkdtempSync(join(tmpdir(), "serene-pgbin-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it("prefers --pg-bin, then PATH, and reports a missing program", () => {
      const explicit = join(root, "explicit");
      const onPath = join(root, "path");
      mkdirSync(explicit);
      mkdirSync(onPath);
      writeFileSync(join(onPath, "pg_dump"), "");
      expect(findPgProgram("pg_dump", { path: onPath, platform: "linux" })).toBe(
        join(onPath, "pg_dump"),
      );
      writeFileSync(join(explicit, "pg_dump"), "");
      expect(findPgProgram("pg_dump", { pgBin: explicit, path: onPath, platform: "linux" })).toBe(
        join(explicit, "pg_dump"),
      );
      expect(findPgProgram("pg_restore", { path: onPath, platform: "linux" })).toBeNull();
    });
  });
});
