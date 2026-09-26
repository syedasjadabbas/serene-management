import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { PropertyContext, SessionContext } from "@/lib/http/context";
import { AppError, forbidden, notFound } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import {
  hasOrganizationPermission,
  hasPermission,
  hasPermissionAnywhere,
  propertiesWithPermission,
} from "@/lib/permissions/evaluate";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { toCsv } from "@/lib/utils/csv";
import { type MoneyUnits, formatMoney, parseMoney } from "@/lib/utils/money";
import { searchAvailability } from "@/modules/availability/availability.service";
import { daysBetween } from "@/modules/business-date/business-date.policy";
import {
  getBusinessDateView,
  getCurrentBusinessDate,
} from "@/modules/business-date/business-date.service";
import { findOrganization, findPropertiesByIds } from "@/modules/properties/properties.repository";
import {
  type RoomNightFacts,
  adr,
  availableRooms,
  occupancy,
  revpar,
} from "@/modules/reports/reports.policy";
import {
  getDashboard,
  propertyOpenBalance,
  propertyPerformance,
} from "@/modules/reports/reports.service";
import type { CentralAvailabilityQuery, OrganizationPerformanceQuery } from "./organization.schema";
import type {
  CentralAvailabilityResult,
  OrganizationOverview,
  OrganizationPerformanceReport,
  OrganizationPropertyRef,
  PerformanceFigures,
} from "./organization.types";

/**
 * Organization workspace reads (Phase 9). Every read fans out over the
 * properties the caller may access — never others — through the existing
 * per-property services, with bounded concurrency (D38). Each property keeps
 * its own business date and currency; money is never converted or summed
 * across currencies (D4).
 */

const FAN_OUT = 4;

async function propertyContexts(
  ctx: SessionContext,
  propertyIds: string[],
): Promise<(PropertyContext & { property: OrganizationPropertyRef })[]> {
  const rows = await findPropertiesByIds(prisma, ctx.organizationId, propertyIds);
  return mapWithConcurrency(rows, FAN_OUT, async (row) => ({
    ...ctx,
    propertyId: row.id,
    propertyCode: row.code,
    timezone: row.timezone,
    currencyCode: row.currencyCode,
    businessDate: await getCurrentBusinessDate(row.id),
    property: {
      id: row.id,
      code: row.code,
      name: row.name,
      currencyCode: row.currencyCode,
      timezone: row.timezone,
    },
  }));
}

/** Accessible properties holding every permission, optionally narrowed by the request. */
function scopedProperties(
  ctx: SessionContext,
  permissions: Permission[],
  requested: string[] | undefined,
): string[] {
  const allowed = Object.keys(ctx.access.byProperty).filter((id) =>
    permissions.every((p) => hasPermission(ctx.access, id, p)),
  );
  if (!requested) return allowed;
  // A requested property outside the caller's scope is refused, never silently dropped.
  if (requested.some((id) => !allowed.includes(id))) {
    throw new AppError("FORBIDDEN", "You do not have access to this property");
  }
  return allowed.filter((id) => requested.includes(id));
}

// --- Overview -----------------------------------------------------------------------------------

export async function getOrganizationOverview(ctx: SessionContext): Promise<OrganizationOverview> {
  const organization = await findOrganization(prisma, ctx.organizationId);
  if (!organization) throw notFound("Organization");
  const contexts = await propertyContexts(ctx, Object.keys(ctx.access.byProperty));
  const properties = await mapWithConcurrency(contexts, FAN_OUT, async (pctx) => {
    const dashboard =
      pctx.businessDate && hasPermission(ctx.access, pctx.propertyId, "dashboard:read")
        ? await getDashboard(pctx)
        : null;
    const date = await getBusinessDateView({
      propertyId: pctx.propertyId,
      timezone: pctx.timezone,
    });
    return {
      property: pctx.property,
      businessDate: pctx.businessDate,
      dateStatus: date.status,
      auditState: date.sync?.state ?? null,
      today: dashboard
        ? {
            arrivalsExpected: dashboard.today.arrivalsExpected,
            arrivalsDone: dashboard.today.arrivalsDone,
            departuresExpected: dashboard.today.departuresExpected,
            departuresDone: dashboard.today.departuresDone,
            inHouse: dashboard.today.inHouse,
            roomsOccupied: dashboard.today.roomsOccupied,
            roomsAvailable: dashboard.today.roomsAvailable,
            occupancy: dashboard.today.occupancy,
          }
        : null,
      openBalance: dashboard?.finance?.openBalance ?? null,
    };
  });
  return {
    organization,
    properties,
    access: {
      reports: hasPermissionAnywhere(ctx.access, "reports:read"),
      availability:
        hasPermissionAnywhere(ctx.access, "search:global") &&
        propertiesWithPermission(ctx.access, "availability:read").length > 0,
      audit: hasPermissionAnywhere(ctx.access, "audit:read"),
      users:
        hasPermissionAnywhere(ctx.access, "users:read") ||
        hasPermissionAnywhere(ctx.access, "users:manage"),
      manageProperties: hasOrganizationPermission(ctx.access, "properties:manage"),
    },
  };
}

// --- Performance report -------------------------------------------------------------------------

interface Totals {
  nights: number;
  facts: RoomNightFacts;
  arrivals: number;
  departures: number;
  noShows: number;
  cancellations: number;
  roomRevenue: MoneyUnits;
  totalRevenue: MoneyUnits;
  tax: MoneyUnits;
  payments: MoneyUnits;
  refunds: MoneyUnits;
  openBalance: MoneyUnits;
}

const EMPTY_TOTALS: Totals = {
  nights: 0,
  facts: { physical: 0, outOfOrder: 0, sold: 0, complimentary: 0, houseUse: 0 },
  arrivals: 0,
  departures: 0,
  noShows: 0,
  cancellations: 0,
  roomRevenue: 0n,
  totalRevenue: 0n,
  tax: 0n,
  payments: 0n,
  refunds: 0n,
  openBalance: 0n,
};

/** Adds two totals of the SAME currency (callers group by currency first, D4). */
function addTotals(a: Totals, b: Totals): Totals {
  return {
    nights: a.nights + b.nights,
    facts: {
      physical: a.facts.physical + b.facts.physical,
      outOfOrder: a.facts.outOfOrder + b.facts.outOfOrder,
      sold: a.facts.sold + b.facts.sold,
      complimentary: a.facts.complimentary + b.facts.complimentary,
      houseUse: a.facts.houseUse + b.facts.houseUse,
    },
    arrivals: a.arrivals + b.arrivals,
    departures: a.departures + b.departures,
    noShows: a.noShows + b.noShows,
    cancellations: a.cancellations + b.cancellations,
    roomRevenue: a.roomRevenue + b.roomRevenue,
    totalRevenue: a.totalRevenue + b.totalRevenue,
    tax: a.tax + b.tax,
    payments: a.payments + b.payments,
    refunds: a.refunds + b.refunds,
    openBalance: a.openBalance + b.openBalance,
  };
}

function figures(t: Totals, financial: boolean): PerformanceFigures {
  const m = (value: MoneyUnits) => (financial ? formatMoney(value) : null);
  return {
    nights: t.nights,
    roomsAvailable: availableRooms(t.facts),
    roomsSold: t.facts.sold,
    occupancy: occupancy(t.facts),
    arrivals: t.arrivals,
    departures: t.departures,
    noShows: t.noShows,
    cancellations: t.cancellations,
    adr: financial ? adr(t.facts, t.roomRevenue) : null,
    revpar: financial ? revpar(t.facts, t.roomRevenue) : null,
    roomRevenue: m(t.roomRevenue),
    totalRevenue: m(t.totalRevenue),
    tax: m(t.tax),
    payments: m(t.payments),
    refunds: m(t.refunds),
    openBalance: m(t.openBalance),
  };
}

export async function organizationPerformance(
  ctx: SessionContext,
  query: OrganizationPerformanceQuery,
): Promise<OrganizationPerformanceReport> {
  if (!hasPermissionAnywhere(ctx.access, "reports:read")) throw forbidden("reports:read");
  const ids = scopedProperties(ctx, ["reports:read"], query.propertyIds);
  const contexts = await propertyContexts(ctx, ids);
  const results = await mapWithConcurrency(contexts, FAN_OUT, async (pctx) => {
    const financial = hasPermission(ctx.access, pctx.propertyId, "reports:financial");
    const performance = await propertyPerformance(pctx, query.from, query.to);
    const date = await getBusinessDateView({
      propertyId: pctx.propertyId,
      timezone: pctx.timezone,
    });
    return {
      pctx,
      performance,
      financial,
      openBalance: performance && financial ? (await propertyOpenBalance(pctx)).balance : 0n,
      dateStatus: date.status,
    };
  });

  const report: OrganizationPerformanceReport = {
    from: query.from,
    to: query.to,
    properties: [],
    currencies: [],
    overall: {
      propertyCount: 0,
      nights: 0,
      roomsAvailable: 0,
      roomsSold: 0,
      occupancy: "0.00",
      arrivals: 0,
      departures: 0,
      noShows: 0,
      cancellations: 0,
    },
    excluded: [],
    notes: [
      "Each property reports in its own currency; totals are per currency and never converted.",
      "Dates are business dates of each property. Closed dates come from night audit snapshots.",
    ],
  };
  const groups = new Map<string, { totals: Totals; count: number; financial: boolean }>();
  for (const { pctx, performance, financial, openBalance, dateStatus } of results) {
    if (!performance) {
      report.excluded.push({
        property: pctx.property,
        reason: pctx.businessDate ? "RANGE_AFTER_OPEN_DATE" : "NOT_LIVE",
      });
      continue;
    }
    const totals: Totals = {
      nights: performance.nights,
      facts: performance.facts,
      ...performance.movements,
      roomRevenue: performance.roomRevenue,
      totalRevenue: performance.totalRevenue,
      tax: performance.tax,
      payments: performance.payments,
      refunds: performance.refunds,
      openBalance,
    };
    report.properties.push({
      property: pctx.property,
      currencyCode: pctx.currencyCode,
      businessDate: performance.businessDate,
      dateStatus,
      coveredTo: performance.coveredTo,
      liveIncluded: performance.liveIncluded,
      financial,
      ...figures(totals, financial),
    });
    const group = groups.get(pctx.currencyCode) ?? {
      totals: EMPTY_TOTALS,
      count: 0,
      financial: true,
    };
    group.totals = addTotals(group.totals, totals);
    group.count += 1;
    group.financial &&= financial;
    groups.set(pctx.currencyCode, group);
  }
  report.currencies = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currencyCode, group]) => ({
      currencyCode,
      propertyCount: group.count,
      financial: group.financial,
      ...figures(group.totals, group.financial),
    }));
  // Counts are currency-free and may be totalled across every property.
  const all = [...groups.values()].reduce((sum, g) => addTotals(sum, g.totals), EMPTY_TOTALS);
  const allFigures = figures(all, false);
  report.overall = {
    propertyCount: report.properties.length,
    nights: allFigures.nights,
    roomsAvailable: allFigures.roomsAvailable,
    roomsSold: allFigures.roomsSold,
    occupancy: allFigures.occupancy,
    arrivals: allFigures.arrivals,
    departures: allFigures.departures,
    noShows: allFigures.noShows,
    cancellations: allFigures.cancellations,
  };
  if (report.properties.some((p) => p.liveIncluded)) {
    report.notes.push(
      "Figures marked live include a property's open business date: its revenue is the day so far.",
    );
  }
  if (report.properties.some((p) => !p.financial)) {
    report.notes.push("Revenue columns need the financial reports permission at that property.");
  }
  return report;
}

/**
 * CSV of the organization performance report (the Phase 8 CSV helper). Only
 * properties where the caller may also export reports are included; money
 * columns sit next to an explicit currency column and are never totalled
 * across currencies.
 */
export async function exportOrganizationPerformance(
  ctx: SessionContext,
  query: OrganizationPerformanceQuery,
): Promise<Response> {
  const exportable = scopedProperties(ctx, ["reports:read", "reports:export"], undefined);
  if (exportable.length === 0) throw forbidden("reports:export");
  const requested = query.propertyIds?.filter((id) => exportable.includes(id));
  if (query.propertyIds && requested?.length !== query.propertyIds.length) {
    throw new AppError("FORBIDDEN", "You do not have access to this property");
  }
  const report = await organizationPerformance(ctx, {
    ...query,
    propertyIds: requested ?? exportable,
  });
  const header = [
    "Row",
    "Currency",
    "Business date",
    "Nights",
    "Available",
    "Sold",
    "Occupancy %",
    "Arrivals",
    "Departures",
    "No-shows",
    "Cancellations",
    "ADR",
    "RevPAR",
    "Room revenue",
    "Total revenue",
    "Tax",
    "Payments",
    "Refunds",
    "Open balance",
  ];
  const cells = (f: PerformanceFigures) => [
    f.nights,
    f.roomsAvailable,
    f.roomsSold,
    f.occupancy,
    f.arrivals,
    f.departures,
    f.noShows,
    f.cancellations,
    f.adr,
    f.revpar,
    f.roomRevenue,
    f.totalRevenue,
    f.tax,
    f.payments,
    f.refunds,
    f.openBalance,
  ];
  const rows = [
    ...report.properties.map((p) => [
      `${p.property.code} ${p.property.name}${p.liveIncluded ? " (live)" : ""}`,
      p.currencyCode,
      p.businessDate,
      ...cells(p),
    ]),
    ...report.currencies.map((c) => [`Total ${c.currencyCode}`, c.currencyCode, null, ...cells(c)]),
  ];
  const csv = toCsv(header, rows);
  const filename = `organization-performance-${report.from}_${report.to}.csv`;
  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// --- Central availability -----------------------------------------------------------------------

export async function centralAvailability(
  ctx: SessionContext,
  query: CentralAvailabilityQuery,
): Promise<CentralAvailabilityResult> {
  if (!hasPermissionAnywhere(ctx.access, "search:global")) throw forbidden("search:global");
  const ids = scopedProperties(ctx, ["search:global", "availability:read"], query.propertyIds);
  if (ids.length === 0) throw forbidden("availability:read");
  const contexts = await propertyContexts(ctx, ids);
  const properties = await mapWithConcurrency(contexts, FAN_OUT, async (pctx) => {
    const base = {
      property: pctx.property,
      businessDate: pctx.businessDate,
      canBook: hasPermission(ctx.access, pctx.propertyId, "reservations:create"),
    };
    if (!pctx.businessDate) {
      return {
        ...base,
        status: "NOT_LIVE" as const,
        message: "Not live yet",
        roomTypes: [],
        canBook: false,
      };
    }
    if (query.arrival < pctx.businessDate) {
      return {
        ...base,
        status: "ARRIVAL_IN_PAST" as const,
        message: `Arrival is before the business date ${pctx.businessDate}`,
        roomTypes: [],
        canBook: false,
      };
    }
    const view = await searchAvailability(pctx, {
      arrival: query.arrival,
      departure: query.departure,
      adults: query.adults,
      children: query.children,
      rooms: query.rooms,
    });
    const roomTypes = view.roomTypes.map((rt) => {
      const bookable = rt.rates.filter((r) => r.bookable && r.total !== null);
      const lowest = bookable.reduce<string | null>(
        (min, r) => (min === null || parseMoney(r.total!) < parseMoney(min) ? r.total : min),
        null,
      );
      return {
        id: rt.roomType.id,
        code: rt.roomType.code,
        name: rt.roomType.name,
        status: rt.status,
        available: rt.available,
        lowestTotal: lowest,
        bookableRates: bookable.length,
      };
    });
    const sellable = roomTypes.some((rt) => rt.status === "AVAILABLE" && rt.bookableRates > 0);
    return {
      ...base,
      status: sellable ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
      message: null,
      roomTypes,
    };
  });
  return {
    arrival: query.arrival,
    departure: query.departure,
    nights: daysBetween(query.arrival, query.departure),
    adults: query.adults,
    children: query.children,
    rooms: query.rooms,
    properties,
    notes: [
      "Prices are in each property's own currency and are not converted.",
      "Booking happens in one property: choose Book to continue there.",
    ],
  };
}
