import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { AppError, forbidden } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import { toCsv } from "@/lib/utils/csv";
import { type MoneyUnits, formatMoney, parseMoney } from "@/lib/utils/money";
import { addDays } from "@/modules/business-date/business-date.policy";
import {
  countRoomsForNight,
  findAuditConfiguration,
  sumMoneyForDate,
} from "@/modules/night-audit/night-audit.repository";
import { currencyMinorUnits } from "@/modules/rates/rates.service";
import {
  type RoomNightFacts,
  adr,
  availableRooms,
  occupancy,
  perRoom,
  revpar,
} from "./reports.policy";
import {
  AUDIT_TRAIL_LIMIT,
  countRoomStates,
  countTodayMovements,
  findAdjustments,
  findArrivalsBetween,
  findAuditRuns,
  findAuditTrail,
  findBalancesAsOf,
  findCancellationsBetween,
  findDeparturesBetween,
  findHousekeepingTasks,
  findInHouse,
  findLedgerMovement,
  findNoShowsBetween,
  findRoomStatus,
  findRoomTypeStatistics,
  findStatistics,
  findVoidsAndRefunds,
  type StatisticsRow,
  type StayListRow,
  sumByTransactionCode,
  sumOpenBalances,
  sumPackageRevenue,
  sumPaymentsByMethod,
  sumRoomProduction,
  sumTaxes,
} from "./reports.repository";
import type { ReportKey, ReportQuery } from "./reports.schema";
import type {
  DashboardView,
  ReportCatalogItem,
  ReportColumn,
  ReportResult,
  ReportRow,
} from "./reports.types";

/**
 * Reports (docs/PMS_WORKFLOWS.md §28, Guide §25): a registry of server-side
 * SQL reports with role-based access (reports:read for operations and
 * rooms, reports:financial for money, nightaudit:read / audit:read for the
 * audit group) and CSV export (reports:export). Closed dates read the
 * statistics snapshots and the immutable ledger; the open business date is
 * computed live and labelled as such.
 */

interface ReportEnv {
  ctx: PropertyContext;
  businessDate: string;
  from: string;
  to: string;
  roomTypeId: string | null;
  risk: string | null;
  financial: boolean;
  noShowCodeId: string | null;
}

interface ReportOutput {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  notes: string[];
}

interface ReportDefinition extends ReportCatalogItem {
  permission: Permission;
  run: (env: ReportEnv) => Promise<ReportOutput>;
}

const col = (key: string, label: string, type: ReportColumn["type"] = "text"): ReportColumn => ({
  key,
  label,
  type,
});

const money = (value: string | null | undefined) =>
  value === null || value === undefined ? null : formatMoney(parseMoney(value));
const units = (value: string | null | undefined): MoneyUnits =>
  value === null || value === undefined ? 0n : parseMoney(value);

function sumColumn(rows: ReportRow[], key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function sumMoneyColumn(rows: ReportRow[], key: string): string {
  return formatMoney(rows.reduce((total, row) => total + units(row[key] as string | null), 0n));
}

/** Nights of the range covered by statistics: closed dates, capped at the open date. */
function coveredTo(env: ReportEnv): string {
  return env.to < env.businessDate ? env.to : env.businessDate;
}

// --- Occupancy facts (snapshot or live) -----------------------------------------------------------

interface NightFacts extends RoomNightFacts {
  businessDate: string;
  live: boolean;
  arrivals: number;
  departures: number;
  stayovers: number;
  noShows: number;
  cancellations: number;
  walkIns: number;
  guests: number;
  roomRevenue: MoneyUnits;
  packageRevenue: MoneyUnits;
  otherRevenue: MoneyUnits;
  tax: MoneyUnits;
  noShowRevenue: MoneyUnits;
  payments: MoneyUnits;
  refunds: MoneyUnits;
  voids: MoneyUnits;
  adjustments: MoneyUnits;
  outOfService: number;
}

function factsFromSnapshot(row: StatisticsRow): NightFacts {
  return {
    businessDate: row.business_date,
    live: false,
    physical: row.physical_rooms,
    outOfOrder: row.out_of_order_rooms,
    outOfService: row.out_of_service_rooms,
    sold: row.rooms_sold,
    complimentary: row.complimentary_rooms,
    houseUse: row.house_use_rooms,
    arrivals: row.arrivals,
    departures: row.departures,
    stayovers: row.stayovers,
    noShows: row.no_shows,
    cancellations: row.cancellations,
    walkIns: row.walk_ins,
    guests: row.adults + row.children,
    roomRevenue: units(row.room_revenue),
    packageRevenue: units(row.package_revenue),
    otherRevenue: units(row.other_revenue),
    tax: units(row.tax_total),
    noShowRevenue: units(row.no_show_revenue),
    payments: units(row.payments_total),
    refunds: units(row.refunds_total),
    voids: units(row.voids_total),
    adjustments: units(row.adjustments_total),
  };
}

/** The open date, live: tonight's rooms as they stand, the day's ledger so far. */
async function liveFacts(env: ReportEnv): Promise<NightFacts> {
  const rooms = await countRoomsForNight(prisma, env.ctx.propertyId, env.businessDate);
  const cash = await sumMoneyForDate(
    prisma,
    env.ctx.propertyId,
    env.businessDate,
    env.noShowCodeId,
  );
  return {
    businessDate: env.businessDate,
    live: true,
    physical: rooms.physical_rooms,
    outOfOrder: rooms.out_of_order_rooms,
    outOfService: rooms.out_of_service_rooms,
    sold: rooms.rooms_sold,
    complimentary: rooms.complimentary_rooms,
    houseUse: rooms.house_use_rooms,
    arrivals: rooms.arrivals,
    departures: rooms.departures,
    stayovers: rooms.stayovers,
    noShows: rooms.no_shows,
    cancellations: rooms.cancellations,
    walkIns: rooms.walk_ins,
    guests: rooms.adults + rooms.children,
    roomRevenue: units(cash.room_revenue),
    packageRevenue: units(cash.package_revenue),
    otherRevenue: units(cash.other_revenue),
    tax: units(cash.tax_total),
    noShowRevenue: units(cash.no_show_revenue),
    payments: units(cash.payments_total),
    refunds: units(cash.refunds_total),
    voids: units(cash.voids_total),
    adjustments: units(cash.adjustments_total),
  };
}

async function nightFacts(env: ReportEnv, from: string, to: string): Promise<NightFacts[]> {
  const snapshots = (
    await findStatistics(prisma, { propertyId: env.ctx.propertyId, from, to })
  ).map(factsFromSnapshot);
  if (from <= env.businessDate && env.businessDate <= to) snapshots.push(await liveFacts(env));
  return snapshots;
}

function totalFacts(list: NightFacts[]): RoomNightFacts & { roomRevenue: MoneyUnits } {
  return list.reduce(
    (total, f) => ({
      physical: total.physical + f.physical,
      outOfOrder: total.outOfOrder + f.outOfOrder,
      sold: total.sold + f.sold,
      complimentary: total.complimentary + f.complimentary,
      houseUse: total.houseUse + f.houseUse,
      roomRevenue: total.roomRevenue + f.roomRevenue,
    }),
    { physical: 0, outOfOrder: 0, sold: 0, complimentary: 0, houseUse: 0, roomRevenue: 0n },
  );
}

const LIVE_NOTE =
  "The open business date is live: tonight's room charges post at night audit, so its revenue is the day so far.";
const FINANCIAL_HIDDEN = "Revenue columns need the financial reports permission.";

// --- Report definitions ---------------------------------------------------------------------------

const stayColumns = [
  col("confirmation", "Confirmation"),
  col("guest", "Guest"),
  col("status", "Status"),
  col("roomType", "Room type"),
  col("room", "Room"),
  col("ratePlan", "Rate plan"),
  col("arrival", "Arrival", "date"),
  col("departure", "Departure", "date"),
  col("nights", "Nights", "number"),
  col("guests", "Guests", "number"),
  col("company", "Company"),
  col("group", "Group"),
];

function stayRow(row: StayListRow): ReportRow {
  return {
    confirmation: `${row.confirmation_number}-${row.line_number}`,
    guest: row.is_vip ? `${row.guest_name} (VIP)` : row.guest_name,
    status: row.status.replace("_", " ").toLowerCase(),
    roomType: row.room_type,
    room: row.room_number,
    ratePlan: row.rate_plan,
    arrival: row.arrival,
    departure: row.departure,
    nights: row.nights,
    guests: row.adults + row.children,
    company: row.company,
    group: row.group_code,
  };
}

function stayTotals(rows: ReportRow[]): ReportRow {
  return {
    confirmation: `${rows.length} rooms`,
    nights: sumColumn(rows, "nights"),
    guests: sumColumn(rows, "guests"),
  };
}

const REPORTS: ReportDefinition[] = [
  {
    key: "manager-flash",
    title: "Manager's flash",
    group: "OPERATIONS",
    description:
      "The day and the month to date: rooms, movements and (with finance access) revenue and KPIs.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const day = coveredTo(env);
      const monthStart = `${day.slice(0, 8)}01`;
      const month = await nightFacts(env, monthStart, day);
      const today = month.filter((f) => f.businessDate === day);
      const sums = (list: NightFacts[]) => {
        const t = totalFacts(list);
        const add = (pick: (f: NightFacts) => number) => list.reduce((n, f) => n + pick(f), 0);
        const addMoney = (pick: (f: NightFacts) => MoneyUnits) =>
          list.reduce((n, f) => n + pick(f), 0n);
        return {
          facts: t,
          arrivals: add((f) => f.arrivals),
          departures: add((f) => f.departures),
          stayovers: add((f) => f.stayovers),
          noShows: add((f) => f.noShows),
          cancellations: add((f) => f.cancellations),
          walkIns: add((f) => f.walkIns),
          guests: add((f) => f.guests),
          roomRevenue: addMoney((f) => f.roomRevenue),
          packageRevenue: addMoney((f) => f.packageRevenue),
          otherRevenue: addMoney((f) => f.otherRevenue),
          tax: addMoney((f) => f.tax),
          noShowRevenue: addMoney((f) => f.noShowRevenue),
          payments: addMoney((f) => f.payments),
          refunds: addMoney((f) => f.refunds),
        };
      };
      const d = sums(today);
      const m = sums(month);
      const rows: ReportRow[] = [
        { metric: "Rooms available", day: availableRooms(d.facts), month: availableRooms(m.facts) },
        { metric: "Rooms sold", day: d.facts.sold, month: m.facts.sold },
        {
          metric: "Complimentary / house use",
          day: d.facts.complimentary + d.facts.houseUse,
          month: m.facts.complimentary + m.facts.houseUse,
        },
        { metric: "Occupancy %", day: occupancy(d.facts), month: occupancy(m.facts) },
        { metric: "Arrivals", day: d.arrivals, month: m.arrivals },
        { metric: "Departures", day: d.departures, month: m.departures },
        { metric: "Stayovers", day: d.stayovers, month: m.stayovers },
        { metric: "No-shows", day: d.noShows, month: m.noShows },
        { metric: "Cancellations", day: d.cancellations, month: m.cancellations },
        { metric: "Walk-ins", day: d.walkIns, month: m.walkIns },
        { metric: "Guests in house", day: d.guests, month: m.guests },
      ];
      if (env.financial) {
        rows.push(
          {
            metric: "Room revenue",
            day: formatMoney(d.roomRevenue),
            month: formatMoney(m.roomRevenue),
          },
          { metric: "ADR", day: adr(d.facts, d.roomRevenue), month: adr(m.facts, m.roomRevenue) },
          {
            metric: "RevPAR",
            day: revpar(d.facts, d.roomRevenue),
            month: revpar(m.facts, m.roomRevenue),
          },
          {
            metric: "Package revenue",
            day: formatMoney(d.packageRevenue),
            month: formatMoney(m.packageRevenue),
          },
          {
            metric: "Other revenue",
            day: formatMoney(d.otherRevenue),
            month: formatMoney(m.otherRevenue),
          },
          {
            metric: "No-show revenue",
            day: formatMoney(d.noShowRevenue),
            month: formatMoney(m.noShowRevenue),
          },
          { metric: "Taxes", day: formatMoney(d.tax), month: formatMoney(m.tax) },
          { metric: "Payments", day: formatMoney(d.payments), month: formatMoney(m.payments) },
          { metric: "Refunds", day: formatMoney(d.refunds), month: formatMoney(m.refunds) },
        );
      }
      return {
        columns: [
          col("metric", "Figure"),
          col("day", day),
          col("month", `Month to date (from ${monthStart})`),
        ],
        rows,
        totals: null,
        notes: [
          ...(today.some((f) => f.live) ? [LIVE_NOTE] : []),
          ...(env.financial ? [] : [FINANCIAL_HIDDEN]),
          ...(env.to > env.businessDate
            ? [`Shown for ${day}: later dates have not happened yet.`]
            : []),
        ],
      };
    },
  },
  {
    key: "occupancy",
    title: "Occupancy, ADR and RevPAR",
    group: "ROOMS",
    description:
      "Rooms sold against rooms available per night, with average rate and revenue per available room.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const list = await nightFacts(env, env.from, coveredTo(env));
      const rows: ReportRow[] = list.map((f) => ({
        date: f.businessDate,
        physical: f.physical,
        outOfOrder: f.outOfOrder,
        available: availableRooms(f),
        sold: f.sold,
        complimentary: f.complimentary,
        houseUse: f.houseUse,
        occupancy: occupancy(f),
        ...(env.financial
          ? {
              roomRevenue: formatMoney(f.roomRevenue),
              adr: adr(f, f.roomRevenue),
              revpar: revpar(f, f.roomRevenue),
            }
          : {}),
        source: f.live ? "Open (live)" : "Closed",
      }));
      const total = totalFacts(list);
      return {
        columns: [
          col("date", "Date", "date"),
          col("physical", "Rooms", "number"),
          col("outOfOrder", "Out of order", "number"),
          col("available", "Available", "number"),
          col("sold", "Sold", "number"),
          col("complimentary", "Comp", "number"),
          col("houseUse", "House use", "number"),
          col("occupancy", "Occupancy %", "percent"),
          ...(env.financial
            ? [
                col("roomRevenue", "Room revenue", "money"),
                col("adr", "ADR", "money"),
                col("revpar", "RevPAR", "money"),
              ]
            : []),
          col("source", "Source"),
        ],
        rows,
        totals: {
          date: "Total",
          physical: total.physical,
          outOfOrder: total.outOfOrder,
          available: availableRooms(total),
          sold: total.sold,
          complimentary: total.complimentary,
          houseUse: total.houseUse,
          occupancy: occupancy(total),
          ...(env.financial
            ? {
                roomRevenue: formatMoney(total.roomRevenue),
                adr: adr(total, total.roomRevenue),
                revpar: revpar(total, total.roomRevenue),
              }
            : {}),
        },
        notes: [
          ...(list.some((f) => f.live) ? [LIVE_NOTE] : []),
          ...(env.financial ? [] : [FINANCIAL_HIDDEN]),
          "Dates before go-live or after the open date have no figures.",
        ],
      };
    },
  },
  {
    key: "room-type-performance",
    title: "Room type performance",
    group: "ROOMS",
    description: "Occupancy and (with finance access) revenue per room type over closed dates.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const to = env.to < env.businessDate ? env.to : addDays(env.businessDate, -1);
      const rows =
        to < env.from
          ? []
          : (
              await findRoomTypeStatistics(prisma, {
                propertyId: env.ctx.propertyId,
                from: env.from,
                to,
              })
            ).map((row) => {
              const facts = {
                physical: row.physical_rooms,
                outOfOrder: row.out_of_order_rooms,
                sold: row.rooms_sold,
                complimentary: 0,
                houseUse: 0,
              };
              const revenue = units(row.room_revenue);
              return {
                roomType: `${row.code} · ${row.name}`,
                roomNights: row.physical_rooms,
                available: availableRooms(facts),
                sold: row.rooms_sold,
                occupancy: occupancy(facts),
                arrivals: row.arrivals,
                departures: row.departures,
                ...(env.financial
                  ? {
                      roomRevenue: formatMoney(revenue),
                      adr: adr(facts, revenue),
                      revpar: revpar(facts, revenue),
                    }
                  : {}),
              } satisfies ReportRow;
            });
      return {
        columns: [
          col("roomType", "Room type"),
          col("roomNights", "Room nights", "number"),
          col("available", "Available", "number"),
          col("sold", "Sold", "number"),
          col("occupancy", "Occupancy %", "percent"),
          col("arrivals", "Arrivals", "number"),
          col("departures", "Departures", "number"),
          ...(env.financial
            ? [
                col("roomRevenue", "Room revenue", "money"),
                col("adr", "ADR", "money"),
                col("revpar", "RevPAR", "money"),
              ]
            : []),
        ],
        rows,
        totals: rows.length
          ? {
              roomType: "Total",
              roomNights: sumColumn(rows, "roomNights"),
              available: sumColumn(rows, "available"),
              sold: sumColumn(rows, "sold"),
              arrivals: sumColumn(rows, "arrivals"),
              departures: sumColumn(rows, "departures"),
              ...(env.financial ? { roomRevenue: sumMoneyColumn(rows, "roomRevenue") } : {}),
            }
          : null,
        notes: [
          "Closed dates only (from the night-audit snapshots); ADR here includes complimentary rooms.",
          ...(env.financial ? [] : [FINANCIAL_HIDDEN]),
        ],
      };
    },
  },
  {
    key: "arrivals",
    title: "Arrivals",
    group: "OPERATIONS",
    description: "Reservations arriving in the range: expected, in house or already departed.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: true,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findArrivalsBetween(
          prisma,
          { propertyId: env.ctx.propertyId, from: env.from, to: env.to },
          env.roomTypeId,
        )
      ).map(stayRow);
      return { columns: stayColumns, rows, totals: stayTotals(rows), notes: [] };
    },
  },
  {
    key: "departures",
    title: "Departures",
    group: "OPERATIONS",
    description: "Reservations departing in the range: due out, departed or still to arrive.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: true,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findDeparturesBetween(
          prisma,
          { propertyId: env.ctx.propertyId, from: env.from, to: env.to },
          env.roomTypeId,
        )
      ).map(stayRow);
      return { columns: stayColumns, rows, totals: stayTotals(rows), notes: [] };
    },
  },
  {
    key: "in-house",
    title: "In-house guests",
    group: "OPERATIONS",
    description: "Every guest in house right now.",
    permission: "reports:read",
    ranged: false,
    roomTypeFilter: true,
    riskFilter: false,
    run: async (env) => {
      const rows = (await findInHouse(prisma, env.ctx.propertyId, env.roomTypeId)).map(stayRow);
      return { columns: stayColumns, rows, totals: stayTotals(rows), notes: [] };
    },
  },
  {
    key: "no-shows",
    title: "No-shows",
    group: "OPERATIONS",
    description: "Reservations marked no-show on the business dates in the range.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findNoShowsBetween(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        date: row.business_date,
        ...stayRow(row),
        guaranteed: row.guaranteed ? "Yes" : "No",
      }));
      return {
        columns: [
          col("date", "Business date", "date"),
          ...stayColumns,
          col("guaranteed", "Guaranteed"),
        ],
        rows,
        totals: stayTotals(rows),
        notes: [],
      };
    },
  },
  {
    key: "cancellations",
    title: "Cancellations",
    group: "OPERATIONS",
    description: "Reservations cancelled on the business dates in the range.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findCancellationsBetween(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        date: row.business_date,
        cancellation: row.cancellation_number,
        ...stayRow(row),
        reason: row.reason,
      }));
      return {
        columns: [
          col("date", "Business date", "date"),
          col("cancellation", "Cancellation no."),
          ...stayColumns,
          col("reason", "Reason"),
        ],
        rows,
        totals: stayTotals(rows),
        notes: [],
      };
    },
  },
  {
    key: "room-status",
    title: "Room status",
    group: "ROOMS",
    description: "Every room's front office, housekeeping and service status right now.",
    permission: "reports:read",
    ranged: false,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (await findRoomStatus(prisma, env.ctx.propertyId, env.businessDate)).map(
        (row) => ({
          room: row.number,
          roomType: row.room_type,
          floor: row.floor,
          frontOffice: row.front_office_status.toLowerCase(),
          housekeeping: row.housekeeping_status.toLowerCase(),
          service: row.service_status.replaceAll("_", " ").toLowerCase(),
          guest: row.guest_name,
          departure: row.departure,
          blockedUntil: row.block_until,
        }),
      );
      return {
        columns: [
          col("room", "Room"),
          col("roomType", "Type"),
          col("floor", "Floor"),
          col("frontOffice", "Front office"),
          col("housekeeping", "Housekeeping"),
          col("service", "Service"),
          col("guest", "Guest"),
          col("departure", "Departure", "date"),
          col("blockedUntil", "Blocked until", "date"),
        ],
        rows,
        totals: { room: `${rows.length} rooms` },
        notes: [],
      };
    },
  },
  {
    key: "housekeeping",
    title: "Housekeeping tasks",
    group: "ROOMS",
    description: "Tasks per business date with their status and attendant.",
    permission: "reports:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findHousekeepingTasks(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        date: row.business_date,
        room: row.room_number,
        task: row.task_type,
        status: row.status.replaceAll("_", " ").toLowerCase(),
        attendant: row.attendant,
        completedAt: row.completed_at?.toISOString() ?? null,
        credits: row.credits,
      }));
      return {
        columns: [
          col("date", "Business date", "date"),
          col("room", "Room"),
          col("task", "Task"),
          col("status", "Status"),
          col("attendant", "Attendant"),
          col("completedAt", "Completed", "datetime"),
          col("credits", "Credits", "number"),
        ],
        rows,
        totals: { date: `${rows.length} tasks` },
        notes: [],
      };
    },
  },
  {
    key: "revenue-by-code",
    title: "Revenue by transaction code",
    group: "FINANCE",
    description: "Every ledger line by transaction code: posted, reversed, adjusted and net.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await sumByTransactionCode(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        code: row.code,
        name: row.name,
        bucket: row.bucket.replaceAll("_", " ").toLowerCase(),
        kind: row.group_type === "PAYMENT" ? "Payment" : "Revenue",
        lines: row.lines,
        posted: money(row.posted),
        reversed: money(row.reversed),
        adjusted: money(row.adjusted),
        net: money(row.net),
      }));
      const revenue = rows.filter((r) => r.kind === "Revenue");
      return {
        columns: [
          col("code", "Code"),
          col("name", "Name"),
          col("bucket", "Bucket"),
          col("kind", "Kind"),
          col("lines", "Lines", "number"),
          col("posted", "Posted", "money"),
          col("reversed", "Reversed", "money"),
          col("adjusted", "Adjusted", "money"),
          col("net", "Net", "money"),
        ],
        rows,
        totals: {
          code: "Revenue total",
          lines: sumColumn(revenue, "lines"),
          posted: sumMoneyColumn(revenue, "posted"),
          reversed: sumMoneyColumn(revenue, "reversed"),
          adjusted: sumMoneyColumn(revenue, "adjusted"),
          net: sumMoneyColumn(revenue, "net"),
        },
        notes: [
          "Same-day reversals net out their original lines; prior-day corrections are adjustments.",
          "Payment codes carry negative amounts (credits); the total covers revenue codes only.",
        ],
      };
    },
  },
  {
    key: "tax",
    title: "Tax",
    group: "FINANCE",
    description: "Tax collected by tax code with the taxable base that generated it.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await sumTaxes(prisma, { propertyId: env.ctx.propertyId, from: env.from, to: env.to })
      ).map((row) => ({
        code: row.code,
        name: row.name,
        lines: row.lines,
        base: money(row.base),
        tax: money(row.tax),
        corrections: money(row.corrections),
        net: money(row.net),
      }));
      return {
        columns: [
          col("code", "Code"),
          col("name", "Tax"),
          col("lines", "Lines", "number"),
          col("base", "Taxable base", "money"),
          col("tax", "Tax posted", "money"),
          col("corrections", "Corrections", "money"),
          col("net", "Net tax", "money"),
        ],
        rows,
        totals: {
          code: "Total",
          lines: sumColumn(rows, "lines"),
          base: sumMoneyColumn(rows, "base"),
          tax: sumMoneyColumn(rows, "tax"),
          corrections: sumMoneyColumn(rows, "corrections"),
          net: sumMoneyColumn(rows, "net"),
        },
        notes: ["The taxable base is the net amount of the line each tax was calculated on."],
      };
    },
  },
  {
    key: "payments",
    title: "Payments by method",
    group: "FINANCE",
    description: "Payments captured, voided and refunded per payment method.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await sumPaymentsByMethod(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        method: `${row.method} · ${row.name}`,
        payments: row.payments,
        captured: money(row.captured),
        voided: money(row.voided),
        refunds: row.refunds,
        refunded: money(row.refunded),
        net: money(row.net),
      }));
      return {
        columns: [
          col("method", "Method"),
          col("payments", "Payments", "number"),
          col("captured", "Captured", "money"),
          col("voided", "Voided", "money"),
          col("refunds", "Refunds", "number"),
          col("refunded", "Refunded", "money"),
          col("net", "Net received", "money"),
        ],
        rows,
        totals: {
          method: "Total",
          payments: sumColumn(rows, "payments"),
          captured: sumMoneyColumn(rows, "captured"),
          voided: sumMoneyColumn(rows, "voided"),
          refunds: sumColumn(rows, "refunds"),
          refunded: sumMoneyColumn(rows, "refunded"),
          net: sumMoneyColumn(rows, "net"),
        },
        notes: ["Captured excludes voided payments; net received is captured minus refunds."],
      };
    },
  },
  {
    key: "voids-refunds",
    title: "Voids and refunds",
    group: "FINANCE",
    description: "Every voided payment and refund with its reason and user.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findVoidsAndRefunds(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        date: row.business_date,
        kind: row.kind === "VOID" ? "Void" : "Refund",
        receipt: row.receipt_number,
        method: row.method,
        amount: money(row.amount),
        reason: row.reason,
        user: row.user_name,
      }));
      return {
        columns: [
          col("date", "Business date", "date"),
          col("kind", "Kind"),
          col("receipt", "Receipt"),
          col("method", "Method"),
          col("amount", "Amount", "money"),
          col("reason", "Reason"),
          col("user", "User"),
        ],
        rows,
        totals: { date: "Total", amount: sumMoneyColumn(rows, "amount") },
        notes: [],
      };
    },
  },
  {
    key: "adjustments",
    title: "Adjustments",
    group: "FINANCE",
    description: "Prior-day corrections with reason, user and the original posting date.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findAdjustments(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        date: row.business_date,
        confirmation: row.confirmation,
        code: row.code,
        description: row.description,
        amount: money(row.amount),
        originalDate: row.original_date,
        reason: row.reason,
        comment: row.comment,
        user: row.user_name,
      }));
      return {
        columns: [
          col("date", "Business date", "date"),
          col("confirmation", "Reservation"),
          col("code", "Code"),
          col("description", "Line"),
          col("amount", "Amount", "money"),
          col("originalDate", "Originally posted", "date"),
          col("reason", "Reason"),
          col("comment", "Comment"),
          col("user", "User"),
        ],
        rows,
        totals: { date: "Total", amount: sumMoneyColumn(rows, "amount") },
        notes: ["Same-day reversals are not adjustments and are not listed (D9)."],
      };
    },
  },
  {
    key: "guest-ledger",
    title: "Guest ledger (open balances)",
    group: "FINANCE",
    description: "Every folio with a balance at the end of the chosen business date.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const asOf = coveredTo(env);
      const rows = (await findBalancesAsOf(prisma, env.ctx.propertyId, asOf)).map((row) => ({
        confirmation: row.confirmation ? `${row.confirmation}-${row.line_number}` : null,
        guest: row.guest_name,
        window: row.window,
        status: row.status ? row.status.replace("_", " ").toLowerCase() : null,
        balance: money(row.balance),
      }));
      return {
        columns: [
          col("confirmation", "Reservation"),
          col("guest", "Payee"),
          col("window", "Window", "number"),
          col("status", "Stay status"),
          col("balance", `Balance at end of ${asOf}`, "money"),
        ],
        rows,
        totals: { confirmation: `${rows.length} folios`, balance: sumMoneyColumn(rows, "balance") },
        notes: [
          `Balances include every ledger line up to and including ${asOf}.`,
          ...(asOf === env.businessDate ? [LIVE_NOTE] : []),
        ],
      };
    },
  },
  {
    key: "ledger-roll-forward",
    title: "Ledger roll-forward",
    group: "FINANCE",
    description:
      "Opening balance, charges, payments, corrections and closing balance per business date, checked against the audit snapshots.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const range = { propertyId: env.ctx.propertyId, from: env.from, to: coveredTo(env) };
      if (range.to < range.from) return { columns: [], rows: [], totals: null, notes: [] };
      const movement = await findLedgerMovement(prisma, range);
      const snapshots = new Map(
        (await findStatistics(prisma, range)).map((s) => [s.business_date, s]),
      );
      const rows = movement.map((row) => {
        const snapshot = snapshots.get(row.business_date);
        const check = snapshot
          ? units(snapshot.ledger_closing_balance) === units(row.closing) &&
            units(snapshot.ledger_opening_balance) === units(row.opening)
            ? "Matches"
            : "MISMATCH"
          : row.business_date === env.businessDate
            ? "Open date"
            : "No snapshot";
        return {
          date: row.business_date,
          opening: money(row.opening),
          charges: money(row.charges),
          payments: money(row.payments),
          corrections: money(row.corrections),
          closing: money(row.closing),
          snapshot: check,
        };
      });
      const first = movement[0];
      const last = movement.at(-1);
      return {
        columns: [
          col("date", "Business date", "date"),
          col("opening", "Opening", "money"),
          col("charges", "Charges and taxes", "money"),
          col("payments", "Payments and refunds", "money"),
          col("corrections", "Corrections", "money"),
          col("closing", "Closing", "money"),
          col("snapshot", "Audit snapshot"),
        ],
        rows,
        totals: {
          date: "Period",
          opening: money(first?.opening),
          charges: sumMoneyColumn(rows, "charges"),
          payments: sumMoneyColumn(rows, "payments"),
          corrections: sumMoneyColumn(rows, "corrections"),
          closing: money(last?.closing),
          snapshot: rows.some((r) => r.snapshot === "MISMATCH") ? "MISMATCH" : "Matches",
        },
        notes: [
          "Closing = opening + charges + payments + corrections, from the ledger itself.",
          "A closed date's figures must equal the balances frozen by its night audit.",
        ],
      };
    },
  },
  ...(["rate-plan-production", "company-production", "group-production"] as const).map(
    (key): ReportDefinition => {
      const by = {
        "rate-plan-production": "rate_plan",
        "company-production": "company",
        "group-production": "group",
      }[key] as "rate_plan" | "company" | "group";
      const label = { rate_plan: "Rate plan", company: "Company", group: "Group" }[by];
      return {
        key,
        title: `${label} production`,
        group: "FINANCE",
        description: `Room nights, room revenue and average rate per ${label.toLowerCase()} (by stay night).`,
        permission: "reports:financial",
        ranged: true,
        roomTypeFilter: false,
        riskFilter: false,
        run: async (env) => {
          const rows = (
            await sumRoomProduction(
              prisma,
              { propertyId: env.ctx.propertyId, from: env.from, to: env.to },
              by,
            )
          ).map((row) => ({
            key: row.name && row.name !== row.key ? `${row.key} · ${row.name}` : row.key,
            nights: row.nights,
            revenue: money(row.revenue),
            average: row.nights > 0 ? perRoom(units(row.revenue), row.nights) : null,
          }));
          return {
            columns: [
              col("key", label),
              col("nights", "Room nights", "number"),
              col("revenue", "Room revenue", "money"),
              col("average", "Average rate", "money"),
            ],
            rows,
            totals: {
              key: "Total",
              nights: sumColumn(rows, "nights"),
              revenue: sumMoneyColumn(rows, "revenue"),
            },
            notes: [
              "Room lines by stay night, net of reversals and adjustments; no-show fees are excluded.",
            ],
          };
        },
      };
    },
  ),
  {
    key: "package-revenue",
    title: "Package revenue",
    group: "FINANCE",
    description: "Package component lines posted, by package and component.",
    permission: "reports:financial",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await sumPackageRevenue(prisma, {
          propertyId: env.ctx.propertyId,
          from: env.from,
          to: env.to,
        })
      ).map((row) => ({
        package: row.package,
        component: row.component,
        code: row.code,
        lines: row.lines,
        quantity: row.quantity,
        revenue: money(row.revenue),
      }));
      return {
        columns: [
          col("package", "Package"),
          col("component", "Component"),
          col("code", "Code"),
          col("lines", "Lines", "number"),
          col("quantity", "Quantity", "number"),
          col("revenue", "Revenue", "money"),
        ],
        rows,
        totals: {
          package: "Total",
          lines: sumColumn(rows, "lines"),
          revenue: sumMoneyColumn(rows, "revenue"),
        },
        notes: [
          "Components included in the rate are carved out of the room line; they show here, not in room revenue.",
        ],
      };
    },
  },
  {
    key: "night-audit-history",
    title: "Night audit history",
    group: "AUDIT",
    description: "Every night-audit run with its outcome and totals.",
    permission: "nightaudit:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: false,
    run: async (env) => {
      const rows = (
        await findAuditRuns(prisma, { propertyId: env.ctx.propertyId, from: env.from, to: env.to })
      ).map((row) => {
        const summary = (row.summary ?? {}) as Record<string, unknown>;
        return {
          date: row.business_date,
          attempt: row.attempt,
          status: row.status.toLowerCase(),
          startedAt: row.started_at.toISOString(),
          finishedAt: row.finished_at?.toISOString() ?? null,
          user: row.user_name,
          error: row.error_code,
          roomsPosted: (summary.roomsPosted as number | undefined) ?? null,
          noShows: (summary.noShows as number | undefined) ?? null,
          ...(env.financial ? { charges: money(summary.chargesPosted as string | undefined) } : {}),
        };
      });
      return {
        columns: [
          col("date", "Business date", "date"),
          col("attempt", "Attempt", "number"),
          col("status", "Outcome"),
          col("startedAt", "Started", "datetime"),
          col("finishedAt", "Finished", "datetime"),
          col("user", "Run by"),
          col("error", "Error"),
          col("roomsPosted", "Rooms posted", "number"),
          col("noShows", "No-shows", "number"),
          ...(env.financial ? [col("charges", "Charges posted", "money")] : []),
        ],
        rows,
        totals: null,
        notes: [],
      };
    },
  },
  {
    key: "audit-trail",
    title: "Audit trail",
    group: "AUDIT",
    description: "Every audited action by business date, filterable by risk.",
    permission: "audit:read",
    ranged: true,
    roomTypeFilter: false,
    riskFilter: true,
    run: async (env) => {
      const rows = (
        await findAuditTrail(
          prisma,
          { propertyId: env.ctx.propertyId, from: env.from, to: env.to },
          env.risk,
        )
      ).map((row) => ({
        at: row.created_at.toISOString(),
        date: row.business_date,
        action: row.action,
        resource: row.resource_type,
        risk: row.risk.toLowerCase(),
        user: row.user_name ?? (row.actor_type === "SYSTEM" ? "System" : null),
        reason: row.reason,
      }));
      return {
        columns: [
          col("at", "When", "datetime"),
          col("date", "Business date", "date"),
          col("action", "Action"),
          col("resource", "Resource"),
          col("risk", "Risk"),
          col("user", "User"),
          col("reason", "Reason"),
        ],
        rows,
        totals: null,
        notes:
          rows.length >= AUDIT_TRAIL_LIMIT
            ? [`Showing the latest ${AUDIT_TRAIL_LIMIT} entries; narrow the range to see more.`]
            : [],
      };
    },
  },
];

const BY_KEY = new Map(REPORTS.map((report) => [report.key, report]));

function catalogItem(report: ReportDefinition): ReportCatalogItem {
  return {
    key: report.key,
    title: report.title,
    group: report.group,
    description: report.description,
    ranged: report.ranged,
    roomTypeFilter: report.roomTypeFilter,
    riskFilter: report.riskFilter,
  };
}

const can = (ctx: PropertyContext, permission: Permission) =>
  hasPermission(ctx.access, ctx.propertyId, permission);

/** The reports this user may run at this property. */
export function listReports(ctx: PropertyContext): {
  reports: ReportCatalogItem[];
  canExport: boolean;
} {
  return {
    reports: REPORTS.filter((report) => can(ctx, report.permission)).map(catalogItem),
    canExport: can(ctx, "reports:export"),
  };
}

function requireLiveDate(ctx: PropertyContext): string {
  if (!ctx.businessDate) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "The property is not live yet", {
      reason: "NOT_INITIALIZED",
    });
  }
  return ctx.businessDate;
}

export async function runReport(
  ctx: PropertyContext,
  key: ReportKey,
  query: ReportQuery,
): Promise<ReportResult> {
  const report = BY_KEY.get(key)!;
  if (!can(ctx, report.permission)) throw forbidden(report.permission);
  const businessDate = requireLiveDate(ctx);
  const from = query.from ?? query.to ?? businessDate;
  const to = query.to ?? query.from ?? businessDate;
  if (to < from) {
    throw new AppError("VALIDATION_FAILED", "The end date must be on or after the start date", {
      fields: { to: ["Must be on or after the start date"] },
    });
  }
  const config = await findAuditConfiguration(prisma, ctx.propertyId);
  const env: ReportEnv = {
    ctx,
    businessDate,
    from,
    to,
    roomTypeId: report.roomTypeFilter ? (query.roomTypeId ?? null) : null,
    risk: report.riskFilter ? (query.risk ?? null) : null,
    financial: can(ctx, "reports:financial"),
    noShowCodeId: config.noShowTransactionCodeId,
  };
  const output = await report.run(env);
  return {
    ...catalogItem(report),
    params: { from, to, roomTypeId: env.roomTypeId, risk: env.risk },
    businessDate,
    currencyCode: ctx.currencyCode,
    ...output,
    generatedAt: new Date().toISOString(),
    canExport: can(ctx, "reports:export"),
  };
}

/** CSV export of a report (reports:export on top of the report's own permission). */
export async function exportReport(
  ctx: PropertyContext,
  key: ReportKey,
  query: ReportQuery,
): Promise<Response> {
  if (!can(ctx, "reports:export")) throw forbidden("reports:export");
  const result = await runReport(ctx, key, query);
  const minorUnits = await currencyMinorUnits(prisma, ctx.currencyCode);
  const cell = (column: ReportColumn, value: ReportRow[string]) =>
    column.type === "money" && typeof value === "string" && value !== ""
      ? formatMoney(parseMoney(value), minorUnits)
      : value;
  const lines = result.rows.map((row) => result.columns.map((c) => cell(c, row[c.key] ?? null)));
  if (result.totals) {
    const totals = result.totals;
    lines.push(result.columns.map((c) => cell(c, totals[c.key] ?? null)));
  }
  const csv = toCsv(
    result.columns.map((c) => (c.type === "money" ? `${c.label} (${ctx.currencyCode})` : c.label)),
    lines,
  );
  const filename = `${ctx.propertyCode}-${key}-${result.params.from}${
    result.params.to !== result.params.from ? `_${result.params.to}` : ""
  }.csv`;
  return new Response(`﻿${csv}`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    },
  });
}

// --- Dashboard ----------------------------------------------------------------------------------

export async function getDashboard(ctx: PropertyContext): Promise<DashboardView> {
  const businessDate = requireLiveDate(ctx);
  const financial = can(ctx, "reports:financial");
  const config = await findAuditConfiguration(prisma, ctx.propertyId);
  const env: ReportEnv = {
    ctx,
    businessDate,
    from: addDays(businessDate, -30),
    to: businessDate,
    roomTypeId: null,
    risk: null,
    financial,
    noShowCodeId: config.noShowTransactionCodeId,
  };
  const movements = await countTodayMovements(prisma, ctx.propertyId, businessDate);
  const rooms = await countRoomStates(prisma, ctx.propertyId);
  const live = await liveFacts(env);
  const closed = (
    await findStatistics(prisma, {
      propertyId: ctx.propertyId,
      from: addDays(businessDate, -30),
      to: addDays(businessDate, -1),
    })
  ).map(factsFromSnapshot);
  const last = closed.at(-1) ?? null;
  const balances = financial ? await sumOpenBalances(prisma, ctx.propertyId) : null;
  return {
    businessDate,
    currencyCode: ctx.currencyCode,
    today: {
      arrivalsExpected: movements.arrivals_expected,
      arrivalsDone: movements.arrivals_done,
      departuresExpected: movements.departures_expected,
      departuresDone: movements.departures_done,
      inHouse: movements.in_house,
      vipArrivals: movements.vip_arrivals,
      roomsOccupied: live.sold,
      roomsAvailable: availableRooms(live),
      occupancy: occupancy(live),
    },
    rooms: {
      vacant: rooms.vacant,
      occupied: rooms.occupied,
      dirty: rooms.dirty,
      clean: rooms.clean,
      inspected: rooms.inspected,
      outOfOrder: rooms.out_of_order,
      outOfService: rooms.out_of_service,
    },
    lastClosed: last
      ? {
          businessDate: last.businessDate,
          occupancy: occupancy(last),
          roomsSold: last.sold,
          adr: financial ? adr(last, last.roomRevenue) : null,
          revpar: financial ? revpar(last, last.roomRevenue) : null,
          roomRevenue: financial ? formatMoney(last.roomRevenue) : null,
        }
      : null,
    trend: closed.map((f) => ({
      businessDate: f.businessDate,
      occupancy: occupancy(f),
      adr: financial ? adr(f, f.roomRevenue) : null,
      revpar: financial ? revpar(f, f.roomRevenue) : null,
    })),
    finance: balances
      ? { openBalance: money(balances.balance)!, openFolios: balances.folios }
      : null,
    access: { financial, reports: can(ctx, "reports:read") },
  };
}
