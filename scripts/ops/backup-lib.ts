/**
 * Pure helpers of the backup commands (scripts/ops/backup.ts), kept free of
 * side effects so argument validation and secret handling can be tested.
 */
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface Connection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode: string | null;
}

/** PostgreSQL identifiers the restore command accepts for a target database. */
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function parseConnection(url: string): Connection {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("The database URL must be a postgresql:// URL");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("The database URL must name a database");
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: parsed.searchParams.get("sslmode"),
  };
}

/**
 * libpq environment for pg_dump / pg_restore: the password travels in the
 * child's environment, never on its command line (visible in process lists).
 */
export function libpqEnv(connection: Connection, database = connection.database) {
  return {
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: database,
    ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
  };
}

/** Same server and credentials, another database. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** `<database>_<UTC timestamp>.dump`, sortable by name. */
export function backupFileName(database: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${database}_${stamp}.dump`;
}

/** sha256sum-compatible line: "<hex>  <file name>". */
export function checksumLine(hex: string, fileName: string): string {
  return `${hex}  ${fileName}\n`;
}

export function parseChecksumLine(line: string): string | null {
  const match = /^([0-9a-f]{64})\s/.exec(line.trim() + " ");
  return match ? match[1]! : null;
}

export interface RestoreRequest {
  file: string | undefined;
  targetDb: string | undefined;
  confirmTarget: string | undefined;
  /** Database the application uses (DATABASE_URL / MIGRATION_DATABASE_URL). */
  liveDatabases: string[];
}

/**
 * Restore is never destructive: it only fills a new or empty database whose
 * name the operator typed twice, and never one the application is using.
 * Returns the problems; empty when the request may proceed.
 */
export function restoreProblems(request: RestoreRequest): string[] {
  const problems: string[] = [];
  if (!request.file) problems.push("--file is required (the .dump to restore)");
  if (!request.targetDb) {
    problems.push("--target-db is required (a new or empty database)");
  } else {
    if (!DATABASE_NAME.test(request.targetDb)) {
      problems.push("--target-db must be a lower-case PostgreSQL name (a-z, 0-9, _)");
    }
    if (request.confirmTarget !== request.targetDb) {
      problems.push("--confirm-target must repeat the --target-db name exactly");
    }
    if (request.liveDatabases.includes(request.targetDb)) {
      problems.push(
        "Refusing to restore into the database the application uses; restore into a new " +
          "database and switch over as described in docs/OPERATIONS.md §2.4",
      );
    }
  }
  return problems;
}

/** Replaces every secret occurrence in tool output before it is printed. */
export function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("***");
  }
  return result;
}

/**
 * Locates a PostgreSQL client program: --pg-bin / PG_BIN, then PATH, then
 * (Windows) the newest "C:\Program Files\PostgreSQL\<version>\bin".
 */
export function findPgProgram(
  program: "pg_dump" | "pg_restore",
  options: { pgBin?: string; path?: string; platform?: NodeJS.Platform } = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const exe = platform === "win32" ? `${program}.exe` : program;
  const candidates: string[] = [];
  if (options.pgBin) candidates.push(join(options.pgBin, exe));
  for (const dir of (options.path ?? process.env.PATH ?? "").split(delimiter)) {
    if (dir) candidates.push(join(dir, exe));
  }
  if (platform === "win32") {
    const root = "C:\\Program Files\\PostgreSQL";
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((name) => /^\d+$/.test(name))
        .sort((a, b) => Number(b) - Number(a));
      for (const version of versions) candidates.push(join(root, version, "bin", exe));
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
