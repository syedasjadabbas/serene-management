/**
 * Reference data every environment needs (docs/DEPLOYMENT.md): currencies,
 * the permission catalog and the system role templates. Idempotent: safe to
 * run on every deployment. Used by the development seed (prisma/seed/index.ts)
 * and by the production command `npm run ops:seed` (scripts/ops/seed.ts).
 *
 * Note: permission keys removed from the catalog are deleted, which also
 * removes them from organizations' custom roles; system role templates are
 * rewritten from lib/permissions/roles.ts, and each organization's copy of a
 * template gains the permissions the template gained since it was copied
 * (additive only: nothing an organization holds is ever removed). Without
 * that, a permission added to a template later (`loyalty:read`, Phase 7)
 * never reached the users, whose roles are the organization copies, and
 * there is no role editor to grant it by hand (docs/RBAC.md §2).
 */
import type { Db, Tx } from "../../lib/db/prisma";
import { ALL_PERMISSIONS, PERMISSIONS, isHighRisk } from "../../lib/permissions/catalog";
import { ROLE_TEMPLATES } from "../../lib/permissions/roles";

export const CURRENCIES = [
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

export interface ReferenceSeedSummary {
  currencies: number;
  permissions: number;
  roles: number;
  /** Template permissions newly granted to organization copies of the templates. */
  organizationGrantsAdded: number;
}

export async function seedReferenceData(db: Db): Promise<ReferenceSeedSummary> {
  let organizationGrantsAdded = 0;
  await db.$transaction(
    async (tx) => {
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

      organizationGrantsAdded = await syncOrganizationRoleCopies(tx);
    },
    // A remote database needs more than Prisma's 5 s default for ~100 upserts.
    { maxWait: 15_000, timeout: 120_000 },
  );
  return {
    currencies: CURRENCIES.length,
    permissions: ALL_PERMISSIONS.length,
    roles: Object.keys(ROLE_TEMPLATES).length,
    organizationGrantsAdded,
  };
}

/**
 * Adds to organization copies of the role templates the permissions their
 * template gained since they were copied; never removes one. `organizationId`
 * limits it to one organization (tests); the seed syncs every organization.
 * Returns the number of grants added.
 */
export async function syncOrganizationRoleCopies(tx: Tx, organizationId?: string): Promise<number> {
  const copies = await tx.role.findMany({
    where: {
      organizationId: organizationId ?? { not: null },
      code: { in: Object.keys(ROLE_TEMPLATES) },
    },
    select: { id: true, code: true, permissions: { select: { permissionKey: true } } },
  });
  let added = 0;
  for (const copy of copies) {
    const held = new Set(copy.permissions.map((p) => p.permissionKey));
    const template = ROLE_TEMPLATES[copy.code as keyof typeof ROLE_TEMPLATES];
    const missing = template.permissions.filter((key) => !held.has(key));
    if (missing.length === 0) continue;
    const { count } = await tx.rolePermission.createMany({
      data: missing.map((permissionKey) => ({ roleId: copy.id, permissionKey })),
      skipDuplicates: true,
    });
    added += count;
  }
  return added;
}
