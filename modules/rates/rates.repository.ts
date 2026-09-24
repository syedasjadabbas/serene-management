import "server-only";
import type { Tx } from "@/lib/db/prisma";

/**
 * Active rate plans of a property with the seasons overlapping the stay and
 * their amounts. Rate plans per property are few (tens), so one query with
 * nested selects is bounded.
 */
export function findRatePlansForStay(
  tx: Tx,
  propertyId: string,
  firstNight: string,
  lastNight: string,
) {
  const first = new Date(`${firstNight}T00:00:00.000Z`);
  const last = new Date(`${lastNight}T00:00:00.000Z`);
  return tx.ratePlan.findMany({
    where: { propertyId, status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      currencyCode: true,
      taxInclusive: true,
      parentRatePlanId: true,
      derivationType: true,
      derivationValue: true,
      roundingIncrement: true,
      sellFrom: true,
      sellTo: true,
      stayFrom: true,
      stayTo: true,
      requiresNegotiation: true,
      requiresMembership: true,
      isDayUse: true,
      displayOrder: true,
      cancellationPolicy: { select: { id: true, code: true, name: true, description: true } },
      roomTypes: { select: { roomTypeId: true } },
      seasons: {
        where: { startDate: { lte: last }, endDate: { gte: first } },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          daysOfWeek: true,
          priority: true,
          amounts: {
            select: {
              roomTypeId: true,
              oneAdult: true,
              twoAdults: true,
              threeAdults: true,
              fourAdults: true,
              extraAdult: true,
              extraChild: true,
            },
          },
        },
      },
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}

export type RatePlanRow = Awaited<ReturnType<typeof findRatePlansForStay>>[number];

export function findCurrencyMinorUnits(tx: Tx, code: string) {
  return tx.currency.findUnique({ where: { code }, select: { minorUnits: true } });
}
