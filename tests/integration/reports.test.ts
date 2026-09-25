import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as dashboardRoute } from "@/app/api/v1/properties/[propertyId]/dashboard/route";
import { POST as chargesRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/charges/route";
import { POST as paymentsRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/payments/route";
import { POST as startRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/route";
import { POST as voidRoute } from "@/app/api/v1/properties/[propertyId]/payments/[paymentId]/void/route";
import { GET as exportRoute } from "@/app/api/v1/properties/[propertyId]/reports/[reportKey]/export/route";
import { GET as reportRoute } from "@/app/api/v1/properties/[propertyId]/reports/[reportKey]/route";
import { GET as catalogRoute } from "@/app/api/v1/properties/[propertyId]/reports/route";
import { GET as accountRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/folio/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { prisma } from "@/lib/db/prisma";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import { perRoom } from "@/modules/reports/reports.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

/**
 * Reports (Phase 8): figures against hand-computed ledger totals, closed
 * dates vs the open date, role-based access, property isolation, CSV export.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;
type Handler = typeof chargesRoute;

let org: FixtureOrg;
let A: string;
let B: string;
let inv: Inventory;
let D: string;
let guestId: string;
let fom: CookieJar;
let agent: CookieJar;
let auditor: CookieJar;
let cashier: CookieJar;
let gmB: CookieJar;
let noShowRoom: string;

const key = () => `rp-${randomUUID()}`;
const base = (propertyId: string) => `/api/v1/properties/${propertyId}`;

function post(
  route: Handler,
  jar: CookieJar,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
  idempotencyKey: string | null = key(),
) {
  return call(route, {
    method: "POST",
    path: `${base(A)}${path}`,
    params: { propertyId: A, ...params },
    body,
    jar,
    headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
  });
}

function report(
  jar: CookieJar,
  reportKey: string,
  query: Record<string, string> = {},
  propertyId = A,
  route: Handler = reportRoute as Handler,
  suffix = "",
) {
  const qs = new URLSearchParams(query).toString();
  return call(route, {
    path: `${base(propertyId)}/reports/${reportKey}${suffix}${qs ? `?${qs}` : ""}`,
    params: { propertyId, reportKey },
    jar,
  });
}

/** CSV bodies are not JSON: call the handler directly and read the text. */
async function exportCsv(jar: CookieJar, path: string, reportKey: string) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(new URL(`${base(A)}${path}`, "http://localhost:3000"), {
    headers: {
      cookie: jar.header(),
      "x-forwarded-for": `198.18.0.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
  const response = await (exportRoute as Handler)(request, {
    params: Promise.resolve({ propertyId: A, reportKey }),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

type Row = Record<string, string | number | null>;
const rowsOf = (r: { body: { data: { rows: Row[] } } }) => r.body.data.rows;
const money = (value: string | number | null | undefined) =>
  formatMoney(parseMoney(String(value ?? "0")));

async function sumLedger(where: Parameters<typeof prisma.folioItem.aggregate>[0]["where"]) {
  const r = await prisma.folioItem.aggregate({ where, _sum: { amount: true } });
  return formatMoney(parseMoney(r._sum.amount?.toFixed(4) ?? "0"));
}

let roomCursor = 0;
async function book(type: "GTD" = "GTD") {
  const rooms = inv.roomTypes.KNG!.roomIds;
  const r = await post(
    createReservationRoute as Handler,
    fom,
    "/reservations",
    {},
    {
      arrival: D,
      departure: addDays(D, 2),
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes[type]!,
      guestId,
      roomId: rooms[roomCursor++],
    },
    null,
  );
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  return r.body.data.rooms[0] as { id: string; version: number };
}

async function checkedIn() {
  const rr = await book();
  const r = await post(
    checkInRoute as Handler,
    fom,
    `/reservation-rooms/${rr.id}/check-in`,
    { reservationRoomId: rr.id },
    { version: rr.version },
    null,
  );
  if (r.status !== 201) throw new Error(`Check-in failed: ${JSON.stringify(r.body)}`);
  const account = await call(accountRoute as Handler, {
    path: `${base(A)}/reservation-rooms/${rr.id}/folio`,
    params: { propertyId: A, reservationRoomId: rr.id },
    jar: fom,
  });
  return account.body.data.windows[0] as { id: string; version: number };
}

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 10 }], {
    taxes: [
      {
        code: "GST",
        name: "Sales tax 16%",
        calculation: "PERCENT",
        basis: "NET",
        rate: "16",
        sequence: 1,
        appliesTo: ["1000", "1090", "2000"],
      },
    ],
  });
  await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }]);
  D = inv.businessDate;
  await prisma.room.updateMany({
    where: { propertyId: A },
    data: { housekeepingStatus: "INSPECTED", frontOfficeStatus: "VACANT" },
  });
  guestId = (await createGuestRow(org, "Rafay", "Reports")).id;
  const users = {
    fom: await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    auditor: await createUser(org, "auditor", [{ role: "AUDITOR", property: "A" }]),
    cashier: await createUser(org, "cashier", [{ role: "CASHIER", property: "A" }]),
    gmB: await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]),
  };
  fom = await loginAs(users.fom.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
  auditor = await loginAs(users.auditor.email, TEST_PASSWORD);
  cashier = await loginAs(users.cashier.email, TEST_PASSWORD);
  gmB = await loginAs(users.gmB.email, TEST_PASSWORD);

  // Three guests in house, restaurant 100.00 + 16% tax, cash 50.00, a card payment voided.
  const w1 = await checkedIn();
  await checkedIn();
  await checkedIn();
  const fnb = await post(
    chargesRoute,
    fom,
    `/folios/${w1.id}/charges`,
    { folioId: w1.id },
    {
      transactionCodeId: inv.chargeCodes["2000"]!,
      unitAmount: "100.00",
    },
  );
  expect(fnb.status).toBe(201);
  const cash = await post(
    paymentsRoute as Handler,
    fom,
    `/folios/${w1.id}/payments`,
    { folioId: w1.id },
    {
      methodId: inv.paymentMethods.CASH!,
      amount: "50.00",
      version: fnb.body.data.version,
    },
  );
  expect(cash.status).toBe(201);
  const card = await post(
    paymentsRoute as Handler,
    fom,
    `/folios/${w1.id}/payments`,
    { folioId: w1.id },
    {
      methodId: inv.paymentMethods.CARD!,
      amount: "20.00",
      reference: "AUTH1",
      version: cash.body.data.version,
    },
  );
  expect(card.status).toBe(201);
  const voided = await post(
    voidRoute as Handler,
    fom,
    `/payments/${card.body.data.paymentId}/void`,
    { paymentId: card.body.data.paymentId },
    { reason: "Wrong card", reasonCodeId: inv.reasonCodes["VOID:ERR"]! },
  );
  expect(voided.status).toBe(201);
  // A guaranteed arrival that never comes.
  noShowRoom = (await book()).id;

  const audit = await post(startRoute as Handler, fom, "/night-audits", {}, { reason: "Close" });
  if (audit.body.data?.status !== "COMPLETED") throw new Error(JSON.stringify(audit.body));
});

describe("access", () => {
  it("lists only the reports a role may run", async () => {
    const byAgent = await call(catalogRoute as Handler, {
      path: `${base(A)}/reports`,
      params: { propertyId: A },
      jar: agent,
    });
    const agentKeys = byAgent.body.data.reports.map((r: { key: string }) => r.key);
    expect(agentKeys).toContain("occupancy");
    expect(agentKeys).not.toContain("revenue-by-code");
    expect(agentKeys).not.toContain("audit-trail");
    expect(byAgent.body.data.canExport).toBe(false);
    const byAuditor = await call(catalogRoute as Handler, {
      path: `${base(A)}/reports`,
      params: { propertyId: A },
      jar: auditor,
    });
    expect(byAuditor.body.data.reports.map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(["revenue-by-code", "audit-trail", "night-audit-history"]),
    );
    const byCashier = await call(catalogRoute as Handler, {
      path: `${base(A)}/reports`,
      params: { propertyId: A },
      jar: cashier,
    });
    expect(byCashier.body.data.reports).toEqual([]);
  });

  it("refuses financial reports, exports and other properties without the permission", async () => {
    expect((await report(agent, "revenue-by-code", { from: D, to: D })).status).toBe(403);
    expect((await report(cashier, "occupancy", { from: D, to: D })).status).toBe(403);
    expect((await report(agent, "audit-trail", { from: D, to: D })).status).toBe(403);
    expect(
      (await report(agent, "occupancy", { from: D, to: D }, A, exportRoute as Handler, "/export"))
        .status,
    ).toBe(403);
    expect((await report(gmB, "occupancy", { from: D, to: D }, A)).status).toBe(403);
    expect((await report(fom, "occupancy", { from: D, to: D }, B)).status).toBe(403);
  });

  it("hides revenue columns from operational users", async () => {
    const r = await report(agent, "occupancy", { from: D, to: D });
    expect(r.status).toBe(200);
    const keys = r.body.data.columns.map((c: { key: string }) => c.key);
    expect(keys).not.toContain("roomRevenue");
    expect(keys).not.toContain("adr");
    expect(r.body.data.rows[0].sold).toBe(3);
  });

  it("validates the range and the report key", async () => {
    expect((await report(fom, "occupancy", { from: D, to: addDays(D, -1) })).status).toBe(400);
    expect((await report(fom, "occupancy", { from: D, to: addDays(D, 400) })).status).toBe(400);
    expect((await report(fom, "not-a-report")).status).toBe(400);
  });
});

describe("figures for the closed date", () => {
  it("reports occupancy, ADR and RevPAR from the audit snapshot", async () => {
    const r = await report(fom, "occupancy", { from: D, to: D });
    expect(r.status).toBe(200);
    const [row] = rowsOf(r);
    const roomRevenue = await sumLedger({
      propertyId: A,
      businessDate: fromDateOnly(D),
      transactionCodeId: inv.chargeCodes["1000"]!,
    });
    expect(row).toMatchObject({
      date: D,
      physical: 10,
      outOfOrder: 0,
      available: 10,
      sold: 3,
      occupancy: "30.00",
      source: "Closed",
    });
    expect(money(row!.roomRevenue)).toBe(roomRevenue);
    expect(row!.adr).toBe(perRoom(parseMoney(roomRevenue), 3));
    expect(row!.revpar).toBe(perRoom(parseMoney(roomRevenue), 10));
  });

  it("summarizes revenue by transaction code, netting the void", async () => {
    const r = await report(auditor, "revenue-by-code", { from: D, to: D });
    expect(r.status).toBe(200);
    const byCode = new Map(rowsOf(r).map((row) => [row.code, row]));
    expect(money(byCode.get("2000")!.net)).toBe("100.0000");
    const room = await sumLedger({
      propertyId: A,
      businessDate: fromDateOnly(D),
      transactionCodeId: inv.chargeCodes["1000"]!,
    });
    expect(money(byCode.get("1000")!.net)).toBe(room);
    // Card: posted −20, reversed +20 → net 0; cash −50.
    expect(money(byCode.get("9100")!.net)).toBe("0.0000");
    expect(money(byCode.get("9000")!.net)).toBe("-50.0000");
  });

  it("reports tax as 16% of its taxable base", async () => {
    const r = await report(fom, "tax", { from: D, to: D });
    const [gst] = rowsOf(r);
    const base = parseMoney(String(gst!.base));
    expect(money(gst!.tax)).toBe(formatMoney((base * 16n) / 100n));
  });

  it("reports payments by method with the void separated", async () => {
    const r = await report(fom, "payments", { from: D, to: D });
    const byMethod = new Map(rowsOf(r).map((row) => [String(row.method).split(" · ")[0], row]));
    expect(money(byMethod.get("CASH")!.captured)).toBe("50.0000");
    expect(money(byMethod.get("CARD")!.captured)).toBe("0.0000");
    expect(money(byMethod.get("CARD")!.voided)).toBe("20.0000");
    const voids = await report(fom, "voids-refunds", { from: D, to: D });
    expect(rowsOf(voids)).toHaveLength(1);
    expect(rowsOf(voids)[0]!.kind).toBe("Void");
  });

  it("rolls the ledger forward and matches the audit snapshot", async () => {
    const r = await report(fom, "ledger-roll-forward", { from: D, to: D });
    const [row] = rowsOf(r);
    expect(row!.snapshot).toBe("Matches");
    const closing = await sumLedger({ propertyId: A, businessDate: { lte: fromDateOnly(D) } });
    expect(money(row!.closing)).toBe(closing);
    const ledger = await report(fom, "guest-ledger", { from: D, to: D });
    expect(money(ledger.body.data.totals.balance)).toBe(closing);
  });

  it("lists the no-show and the flash figures", async () => {
    const noShows = await report(agent, "no-shows", { from: D, to: D });
    expect(rowsOf(noShows)).toHaveLength(1);
    expect(rowsOf(noShows)[0]!.guaranteed).toBe("Yes");
    const flash = await report(fom, "manager-flash", { from: D, to: D });
    const figures = new Map(rowsOf(flash).map((row) => [row.metric, row.day]));
    expect(figures.get("Rooms sold")).toBe(3);
    expect(figures.get("No-shows")).toBe(1);
    expect(figures.get("Occupancy %")).toBe("30.00");
    expect(parseMoney(String(figures.get("No-show revenue")))).toBeGreaterThan(0n);
    void noShowRoom;
  });

  it("shows the audit run and its HIGH audit rows", async () => {
    const history = await report(auditor, "night-audit-history", { from: D, to: D });
    expect(rowsOf(history)[0]).toMatchObject({ date: D, status: "completed", noShows: 1 });
    const trail = await report(auditor, "audit-trail", { from: D, to: D, risk: "HIGH" });
    const actions = rowsOf(trail).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["nightaudit.run", "business_date.close"]));
    expect(rowsOf(trail).every((row) => row.risk === "high")).toBe(true);
  });
});

describe("the open date and exports", () => {
  it("labels the open date as live", async () => {
    const next = addDays(D, 1);
    const r = await report(fom, "occupancy", { from: D, to: next });
    expect(rowsOf(r).map((row) => row.source)).toEqual(["Closed", "Open (live)"]);
    expect(r.body.data.notes.join(" ")).toMatch(/live/);
  });

  it("exports the same figures as CSV", async () => {
    const r = await exportCsv(auditor, `/reports/payments/export?from=${D}&to=${D}`, "payments");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename=".*payments/);
    const text = r.text.replace(/^﻿/, "");
    const [header, ...lines] = text.trim().split("\r\n");
    expect(header).toBe(
      "Method,Payments,Captured (PKR),Voided (PKR),Refunds,Refunded (PKR),Net received (PKR)",
    );
    expect(lines.some((line) => line.startsWith("CASH · Cash,1,50.00,0.00"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^Total,/);
  });

  it("serves the dashboard with finance only for finance roles", async () => {
    const byFom = await call(dashboardRoute as Handler, {
      path: `${base(A)}/dashboard`,
      params: { propertyId: A },
      jar: fom,
    });
    expect(byFom.status).toBe(200);
    expect(byFom.body.data.businessDate).toBe(addDays(D, 1));
    expect(byFom.body.data.lastClosed).toMatchObject({
      businessDate: D,
      roomsSold: 3,
      occupancy: "30.00",
    });
    expect(byFom.body.data.finance).not.toBeNull();
    expect(byFom.body.data.today.inHouse).toBe(3);
    const byAgent = await call(dashboardRoute as Handler, {
      path: `${base(A)}/dashboard`,
      params: { propertyId: A },
      jar: agent,
    });
    if (byAgent.status === 200) {
      expect(byAgent.body.data.finance).toBeNull();
      expect(byAgent.body.data.lastClosed.adr).toBeNull();
    } else {
      expect(byAgent.status).toBe(403);
    }
  });
});
