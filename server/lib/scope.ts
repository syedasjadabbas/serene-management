import type { PropertyContext, SessionContext } from "./context";

/**
 * Data scope helpers (docs/SERVER_SPLIT_PLAN.md §3). Every property-scoped
 * query filters by the property taken from the URL path (`ctx.propertyId`),
 * and every organization-scoped query by `ctx.organizationId`. Spread these
 * into a Prisma `where` so the filter cannot be forgotten:
 *
 *   tx.folio.findFirst({ where: { ...propertyWhere(ctx), id: folioId } })
 */
export function propertyWhere(ctx: Pick<PropertyContext, "propertyId">): { propertyId: string } {
  return { propertyId: ctx.propertyId };
}

export function organizationWhere(ctx: Pick<SessionContext, "organizationId">): {
  organizationId: string;
} {
  return { organizationId: ctx.organizationId };
}
