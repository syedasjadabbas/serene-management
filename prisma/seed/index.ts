/**
 * Development seed entry point (`npm run db:seed`).
 *
 * Always seeds reference data: the permission catalog, system role templates
 * and currencies (idempotent, safe in every environment; production uses the
 * compiled `npm run ops:seed`, which contains no demo code). With
 * SEED_DEMO=true and a strong SEED_DEMO_PASSWORD it also creates the demo
 * organization (prisma/seed/demo.ts) — refused when NODE_ENV=production.
 *
 * Runs with the "react-server" export condition so domain services (which
 * import "server-only") can be used outside Next.js.
 */
import "dotenv/config";
import { prisma } from "../../lib/db/prisma";
import { seedDemo } from "./demo";
import { demoSeedDecision } from "./demo-guard";
import { seedReferenceData } from "./reference";

async function main() {
  // Decide before writing anything, so a refused demo seed changes nothing.
  const demo = demoSeedDecision(process.env);
  try {
    const summary = await seedReferenceData(prisma);
    console.warn(
      `Seeded ${summary.currencies} currencies, ${summary.permissions} permissions, ` +
        `${summary.roles} system roles.`,
    );
    if (demo.run) await seedDemo(demo.password);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
