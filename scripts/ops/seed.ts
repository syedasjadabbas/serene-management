/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:seed` — reference data for production (docs/DEPLOYMENT.md):
 * currencies, the permission catalog and the system role templates.
 * Idempotent; run after every `npm run db:deploy`. Contains no demo code:
 * the demo organization can only be created by the development seed.
 */
import { loadEnvFileIfPresent } from "./env-file";

async function main() {
  loadEnvFileIfPresent();
  // Imported after the environment is loaded: the database client reads it.
  const { serverEnv } = await import("../../lib/env");
  serverEnv();
  const { prisma } = await import("../../lib/db/prisma");
  const { seedReferenceData } = await import("../../prisma/seed/reference");
  try {
    const summary = await seedReferenceData(prisma);
    console.log(
      `Reference data up to date: ${summary.currencies} currencies, ` +
        `${summary.permissions} permissions, ${summary.roles} role templates, ` +
        `${summary.organizationGrantsAdded} template permissions added to organization roles.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Reference seed failed");
  process.exit(1);
});
