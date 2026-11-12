/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:seed` — reference data for production (docs/DEPLOYMENT.md):
 * currencies, the permission catalog and the system role templates.
 * Idempotent; run after every `npm run db:deploy`. Contains no demo code:
 * the demo organization can only be created by the development seed.
 *
 *   npm run ops:seed                                       dry run (default): checks the connection
 *   npm run ops:seed -- --apply --yes --database NAME      writes the reference data
 *
 * Exit codes: 0 done · 1 error · 2 invalid arguments or refused.
 */
import { parseArgs } from "node:util";
import {
  OpsRefused,
  WRITE_OPTIONS,
  WRITE_USAGE,
  assertDatabase,
  expectedDatabase,
  resolveWriteMode,
} from "./db-guard";
import { loadEnvFileIfPresent } from "./env-file";

const USAGE = `Usage: npm run ops:seed -- [--apply --yes --database NAME]\n${WRITE_USAGE}`;

async function main(): Promise<number> {
  let values: { help: boolean; database?: string } & Record<string, unknown>;
  let mode: ReturnType<typeof resolveWriteMode>;
  try {
    ({ values } = parseArgs({
      options: { ...WRITE_OPTIONS, help: { type: "boolean", default: false } },
      strict: true,
    }));
    mode = resolveWriteMode(values);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : "Invalid arguments"}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  loadEnvFileIfPresent();
  // Imported after the environment is loaded: the database client reads it.
  const { serverEnv } = await import("@/config/env");
  const env = serverEnv();
  const { prisma } = await import("@/config/prisma");
  try {
    const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    try {
      assertDatabase({
        apply: mode.apply,
        actual: row!.name,
        expected: expectedDatabase(values.database),
        nodeEnv: env.NODE_ENV,
      });
    } catch (error) {
      if (!(error instanceof OpsRefused)) throw error;
      console.error(error.message);
      return 2;
    }
    if (!mode.apply) {
      console.log(
        `Dry run on ${row!.name}: would bring currencies, the permission catalog and role templates up to date. ` +
          `Nothing written; add --apply --yes --database ${row!.name} to write.`,
      );
      return 0;
    }
    const { seedReferenceData } = await import("../../prisma/seed/reference");
    const summary = await seedReferenceData(prisma);
    console.log(
      `Reference data up to date in ${row!.name}: ${summary.currencies} currencies, ` +
        `${summary.permissions} permissions, ${summary.roles} role templates, ` +
        `${summary.organizationGrantsAdded} template permissions added to organization roles.`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Reference seed failed");
    process.exit(1);
  },
);
