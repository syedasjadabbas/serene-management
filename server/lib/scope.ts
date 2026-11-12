import { Prisma } from "@/generated/prisma/client";
import type { PropertyContext, SessionContext } from "./context";

/**
 * Data scope helpers (docs/SERVER_SPLIT_PLAN.md §3). Every property-scoped
 * query filters by the property taken from the URL path (`ctx.propertyId`),
 * and every organization-scoped query by `ctx.organizationId`. Spread these
 * into a Prisma `where` so the filter cannot be forgotten:
 *
 *   tx.folio.findFirst({ where: { ...propertyWhere(ctx), id: folioId } })
 *
 * Each helper accepts a context or any object carrying the id (repositories
 * that only receive a bare id pass `{ propertyId }`).
 */
export type PropertyScope = Pick<PropertyContext, "propertyId">;
export type OrganizationScope = Pick<SessionContext, "organizationId">;

export function propertyWhere(scope: PropertyScope): { propertyId: string } {
  return { propertyId: scope.propertyId };
}

export function organizationWhere(scope: OrganizationScope): { organizationId: string } {
  return { organizationId: scope.organizationId };
}

/** Merge the property filter into an existing where. The scope always wins. */
export function propertyScoped<W extends object>(
  scope: PropertyScope,
  where: W,
): W & { propertyId: string } {
  return { ...where, ...propertyWhere(scope) };
}

/** Merge the organization filter into an existing where. The scope always wins. */
export function organizationScoped<W extends object>(
  scope: OrganizationScope,
  where: W,
): W & { organizationId: string } {
  return { ...where, ...organizationWhere(scope) };
}

const SQL_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

function column(alias: string | undefined, name: string): Prisma.Sql {
  if (alias === undefined) return Prisma.raw(`"${name}"`);
  if (!SQL_ALIAS.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  return Prisma.raw(`${alias}."${name}"`);
}

/** Raw SQL predicate `<alias>."property_id" = $n::uuid` (id is bound, never inlined). */
export function propertyFilterSql(scope: PropertyScope, alias?: string): Prisma.Sql {
  return Prisma.sql`${column(alias, "property_id")} = ${scope.propertyId}::uuid`;
}

/** Raw SQL predicate `<alias>."organization_id" = $n::uuid`. */
export function organizationFilterSql(scope: OrganizationScope, alias?: string): Prisma.Sql {
  return Prisma.sql`${column(alias, "organization_id")} = ${scope.organizationId}::uuid`;
}
