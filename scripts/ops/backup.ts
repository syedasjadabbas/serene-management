/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:backup -- <command>` — logical backups of the application
 * database with the native PostgreSQL client tools (H7, docs/OPERATIONS.md §2).
 *
 *   create  --out-dir DIR                         pg_dump -Fc + .sha256 checksum
 *   verify  --file FILE                           checksum + readable archive + key tables
 *   list    --dir DIR                             backups with size, date, checksum file
 *   restore --file FILE --target-db NAME --confirm-target NAME [--create]
 *                                                 into a NEW or EMPTY database only
 *
 * Connects with MIGRATION_DATABASE_URL (schema owner) when set, else
 * DATABASE_URL. Passwords reach pg_dump/pg_restore through the environment,
 * never the command line, and are never printed. Nothing is ever dropped or
 * overwritten: restoring over a live database is refused.
 *
 * Options: --pg-bin DIR (or PG_BIN) locates pg_dump/pg_restore.
 * Exit codes: 0 ok · 1 failed · 2 invalid arguments or refused.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
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
} from "./backup-lib";
import { loadEnvFileIfPresent } from "./env-file";

const USAGE = `Usage:
  npm run ops:backup -- create  --out-dir DIR
  npm run ops:backup -- verify  --file FILE
  npm run ops:backup -- list    --dir DIR
  npm run ops:backup -- restore --file FILE --target-db NAME --confirm-target NAME [--create]
Options: --pg-bin DIR (directory containing pg_dump / pg_restore)`;

class Refused extends Error {}

function databaseUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Refused("DATABASE_URL (or MIGRATION_DATABASE_URL) is not set");
  return url;
}

function sha256(file: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function run(program: string, args: string[], env: Record<string, string>, secrets: string[]) {
  const result = spawnSync(program, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Could not run ${basename(program)}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = redact((result.stderr || result.stdout || "").trim(), secrets);
    throw new Error(
      `${basename(program)} failed (exit ${result.status})${detail ? `:\n${detail}` : ""}`,
    );
  }
  return result.stdout;
}

function program(name: "pg_dump" | "pg_restore", pgBin: string | undefined): string {
  const found = findPgProgram(name, { pgBin: pgBin ?? process.env.PG_BIN });
  if (!found)
    throw new Refused(`${name} not found; install the PostgreSQL client tools or pass --pg-bin`);
  return found;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

async function create(outDir: string | undefined, pgBin: string | undefined) {
  if (!outDir) throw new Refused("--out-dir is required");
  const url = databaseUrl();
  const connection = parseConnection(url);
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const fileName = backupFileName(connection.database, new Date());
  const target = join(dir, fileName);
  if (existsSync(target)) throw new Refused(`${fileName} already exists`);
  const partial = `${target}.partial`;
  try {
    run(
      program("pg_dump", pgBin),
      ["--format=custom", "--compress=6", "--no-password", `--file=${partial}`],
      libpqEnv(connection),
      [connection.password],
    );
    renameSync(partial, target);
  } finally {
    rmSync(partial, { force: true });
  }
  const hex = await sha256(target);
  writeFileSync(`${target}.sha256`, checksumLine(hex, fileName), { mode: 0o600 });
  console.log(
    [
      "Backup created.",
      `  File:     ${target}`,
      `  Size:     ${humanSize(statSync(target).size)}`,
      `  SHA-256:  ${hex}`,
      `  Database: ${connection.database} on ${connection.host}:${connection.port}`,
      "Next: npm run ops:backup -- verify --file <file>, then copy both files off this host.",
    ].join("\n"),
  );
}

async function verifyChecksum(file: string): Promise<string> {
  const checksumFile = `${file}.sha256`;
  if (!existsSync(checksumFile))
    throw new Error(`Checksum file missing: ${basename(checksumFile)}`);
  const expected = parseChecksumLine(readFileSync(checksumFile, "utf8"));
  if (!expected) throw new Error(`Checksum file unreadable: ${basename(checksumFile)}`);
  const actual = await sha256(file);
  if (actual !== expected)
    throw new Error("Checksum mismatch: the backup file is corrupt or was modified");
  return actual;
}

async function verify(file: string | undefined, pgBin: string | undefined) {
  if (!file) throw new Refused("--file is required");
  if (!existsSync(file)) throw new Refused(`File not found: ${file}`);
  const hex = await verifyChecksum(file);
  const toc = run(program("pg_restore", pgBin), ["--list", file], {}, []);
  const entries = toc.split("\n").filter((line) => /^\d+;/.test(line));
  const tables = entries.filter((line) => / TABLE public /.test(line)).length;
  for (const required of ["_prisma_migrations", "audit_logs", "organizations"]) {
    if (!new RegExp(` TABLE public ${required} `).test(toc)) {
      throw new Error(`Archive has no table ${required}: not a SERENE MANAGEMENT backup`);
    }
  }
  console.log(
    [
      "Backup verified.",
      `  File:     ${resolve(file)}`,
      `  SHA-256:  ${hex} (matches)`,
      `  Archive:  ${entries.length} entries, ${tables} tables, readable by pg_restore`,
      "A full check restores it: npm run ops:backup -- restore … (docs/OPERATIONS.md §2.3).",
    ].join("\n"),
  );
}

function list(dir: string | undefined) {
  if (!dir) throw new Refused("--dir is required");
  if (!existsSync(dir)) throw new Refused(`Directory not found: ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".dump"))
    .sort();
  if (files.length === 0) {
    console.log("No backups (*.dump) found.");
    return;
  }
  for (const name of files) {
    const stat = statSync(join(dir, name));
    const checksum = existsSync(join(dir, `${name}.sha256`)) ? "checksum file" : "NO CHECKSUM FILE";
    console.log(
      `${name}  ${humanSize(stat.size).padStart(10)}  ${stat.mtime.toISOString()}  ${checksum}`,
    );
  }
}

async function restore(
  values: { file?: string; "target-db"?: string; "confirm-target"?: string; create: boolean },
  pgBin: string | undefined,
) {
  const url = databaseUrl();
  const live = [process.env.DATABASE_URL, process.env.MIGRATION_DATABASE_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => parseConnection(value).database);
  const problems = restoreProblems({
    file: values.file,
    targetDb: values["target-db"],
    confirmTarget: values["confirm-target"],
    liveDatabases: live,
  });
  if (problems.length > 0) throw new Refused(problems.join("\n"));
  const file = values.file!;
  const target = values["target-db"]!;
  if (!existsSync(file)) throw new Refused(`File not found: ${file}`);
  await verifyChecksum(file);

  const connection = parseConnection(url);
  const admin = new pg.Client({ connectionString: withDatabase(url, "postgres") });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
    if (exists.rowCount === 0) {
      if (!values.create) {
        throw new Refused(`Database ${target} does not exist; pass --create to create it`);
      }
      // The name is validated against /^[a-z_][a-z0-9_]{0,62}$/ (restoreProblems).
      await admin.query(`CREATE DATABASE "${target}" TEMPLATE template0 ENCODING 'UTF8'`);
      console.log(`Created database ${target}.`);
    } else {
      const probe = new pg.Client({ connectionString: withDatabase(url, target) });
      await probe.connect();
      try {
        const objects = await probe.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'`,
        );
        if ((objects.rows[0] as { n: number }).n > 0) {
          throw new Refused(
            `Database ${target} is not empty; restore only into a new or empty database`,
          );
        }
      } finally {
        await probe.end();
      }
    }
  } finally {
    await admin.end();
  }

  run(
    program("pg_restore", pgBin),
    [
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--exit-on-error",
      "--no-password",
      `--dbname=${target}`,
      file,
    ],
    libpqEnv(connection, target),
    [connection.password],
  );
  console.log(
    [
      `Restored ${basename(file)} into ${target}.`,
      "Next (docs/OPERATIONS.md §2.3):",
      `  MIGRATION_DATABASE_URL=<url of ${target}> npx prisma migrate status`,
      `  DATABASE_URL=<url of ${target}> npm run ops:db-check`,
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const command = process.argv[2];
  let values: {
    "out-dir"?: string;
    file?: string;
    dir?: string;
    "target-db"?: string;
    "confirm-target"?: string;
    create: boolean;
    "pg-bin"?: string;
    help: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        "out-dir": { type: "string" },
        file: { type: "string" },
        dir: { type: "string" },
        "target-db": { type: "string" },
        "confirm-target": { type: "string" },
        create: { type: "boolean", default: false },
        "pg-bin": { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : "Invalid arguments"}\n${USAGE}`);
    return 2;
  }
  if (!command || command === "--help" || values.help) {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  loadEnvFileIfPresent();
  try {
    switch (command) {
      case "create":
        await create(values["out-dir"], values["pg-bin"]);
        return 0;
      case "verify":
        await verify(values.file, values["pg-bin"]);
        return 0;
      case "list":
        list(values.dir);
        return 0;
      case "restore":
        await restore(values, values["pg-bin"]);
        return 0;
      default:
        console.error(`Unknown command "${command}"\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    const secrets = [process.env.DATABASE_URL, process.env.MIGRATION_DATABASE_URL]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => {
        try {
          return [value, parseConnection(value).password];
        } catch {
          return [value];
        }
      });
    const message = redact(
      error instanceof Error ? error.message : "Backup command failed",
      secrets,
    );
    console.error(message);
    return error instanceof Refused ? 2 : 1;
  }
}

main().then((code) => process.exit(code));
