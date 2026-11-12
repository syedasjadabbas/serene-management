/**
 * Shared safety rules for operator commands that write (maintenance, seed,
 * bootstrap, backup restore): dry-run by default, `--apply --yes` to write,
 * and a wrong-database guard. Pure functions, so they are unit-tested without
 * a database.
 */

/** parseArgs options every writing command accepts. */
export const WRITE_OPTIONS = {
  apply: { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  /** Accepted for compatibility: dry-run is the default. */
  "dry-run": { type: "boolean", default: false },
  database: { type: "string" },
} as const;

export const WRITE_USAGE =
  "Safety: dry-run by default (nothing is written). To write: --apply --yes --database <name>,\n" +
  "where <name> must equal the connected database (current_database()); OPS_EXPECTED_DATABASE\n" +
  "may supply it instead of --database. In production, databases ending in _test are refused.";

export interface WriteFlags {
  apply?: boolean;
  yes?: boolean;
  "dry-run"?: boolean;
  database?: string;
}

export type WriteMode = { apply: false } | { apply: true };

export class OpsRefused extends Error {}

/** Dry-run unless both --apply and --yes are given; half of the pair is an error, not a silent dry-run. */
export function resolveWriteMode(flags: WriteFlags): WriteMode {
  if (flags["dry-run"] && (flags.apply || flags.yes)) {
    throw new OpsRefused("--dry-run cannot be combined with --apply/--yes");
  }
  if (flags.apply && !flags.yes) {
    throw new OpsRefused("--apply also needs --yes to write (the default is a dry run)");
  }
  if (flags.yes && !flags.apply) {
    throw new OpsRefused("--yes only confirms --apply; add --apply to write (default: dry run)");
  }
  return { apply: Boolean(flags.apply && flags.yes) };
}

/** The name the operator expects: --database first, then OPS_EXPECTED_DATABASE. */
export function expectedDatabase(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = flag?.trim() || env.OPS_EXPECTED_DATABASE?.trim();
  return value || undefined;
}

/**
 * Refuses a write on the wrong database. `actual` is `current_database()` of
 * the connection the command will write through. Writing requires an expected
 * name that equals it; a dry run only checks a name that was given. In
 * production, a `_test` database is never written by an ops command.
 */
export function databaseGuard(input: {
  apply: boolean;
  actual: string;
  expected?: string;
  nodeEnv?: string;
}): string | null {
  const { apply, actual, expected, nodeEnv } = input;
  if (apply && !expected) {
    return `Refusing to write without --database <name> (or OPS_EXPECTED_DATABASE): the connected database is "${actual}".`;
  }
  if (expected && expected !== actual) {
    return `Refusing to run: expected database "${expected}" but connected to "${actual}".`;
  }
  if (apply && nodeEnv === "production" && actual.endsWith("_test")) {
    return `Refusing to write to "${actual}" in production: _test databases are for tests only.`;
  }
  return null;
}

/** Throws OpsRefused when the guard says no. */
export function assertDatabase(input: Parameters<typeof databaseGuard>[0]): void {
  const problem = databaseGuard(input);
  if (problem) throw new OpsRefused(problem);
}
