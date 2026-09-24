/**
 * Seed entry point (`npm run db:seed`).
 *
 * Always seeds reference data: the permission catalog, system role templates
 * and currencies (idempotent, safe in every environment). With
 * SEED_DEMO=true it also creates the demo organization (prisma/seed/demo.ts),
 * extended phase by phase (docs/IMPLEMENTATION_ROADMAP.md).
 *
 * Runs with the "react-server" export condition so domain services (which
 * import "server-only") can be used outside Next.js.
 */
import "dotenv/config";
import { prisma } from "../../lib/db/prisma";
import { ALL_PERMISSIONS, PERMISSIONS, isHighRisk } from "../../lib/permissions/catalog";
import { ROLE_TEMPLATES } from "../../lib/permissions/roles";
import { seedDemo } from "./demo";

const CURRENCIES = [
  { code: "PKR", name: "Pakistani Rupee", minorUnits: 2 },
  { code: "USD", name: "US Dollar", minorUnits: 2 },
  { code: "EUR", name: "Euro", minorUnits: 2 },
  { code: "GBP", name: "Pound Sterling", minorUnits: 2 },
  { code: "AED", name: "UAE Dirham", minorUnits: 2 },
  { code: "SAR", name: "Saudi Riyal", minorUnits: 2 },
  { code: "KWD", name: "Kuwaiti Dinar", minorUnits: 3 },
  { code: "BHD", name: "Bahraini Dinar", minorUnits: 3 },
  { code: "OMR", name: "Omani Rial", minorUnits: 3 },
];

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      for (const currency of CURRENCIES) {
        await tx.currency.upsert({
          where: { code: currency.code },
          create: currency,
          update: currency,
        });
      }

      for (const key of ALL_PERMISSIONS) {
        const [resource = "", action = ""] = key.split(":");
        const data = {
          resource,
          action,
          description: PERMISSIONS[key].description,
          isHighRisk: isHighRisk(key),
        };
        await tx.permission.upsert({ where: { key }, create: { key, ...data }, update: data });
      }
      // Keys removed from the catalog lose their grants.
      await tx.permission.deleteMany({ where: { key: { notIn: ALL_PERMISSIONS } } });

      for (const [code, template] of Object.entries(ROLE_TEMPLATES)) {
        const existing = await tx.role.findFirst({
          where: { organizationId: null, code },
          select: { id: true },
        });
        const role = existing
          ? await tx.role.update({ where: { id: existing.id }, data: { name: template.name } })
          : await tx.role.create({ data: { code, name: template.name, isSystem: true } });
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({
          data: template.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        });
      }
    });
    console.warn(
      `Seeded ${CURRENCIES.length} currencies, ${ALL_PERMISSIONS.length} permissions, ` +
        `${Object.keys(ROLE_TEMPLATES).length} system roles.`,
    );
    if (process.env.SEED_DEMO === "true") await seedDemo();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
