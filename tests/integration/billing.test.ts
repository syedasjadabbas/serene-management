import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as settleRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/settle/route";
import { POST as chargesRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/charges/route";
import { POST as previewRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/charges/preview/route";
import { GET as itemsRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/items/route";
import { POST as paymentsRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/payments/route";
import { GET as foliosRoute } from "@/app/api/v1/properties/[propertyId]/folios/route";
import { POST as adjustRoute } from "@/app/api/v1/properties/[propertyId]/folio-items/[itemId]/adjust/route";
import { POST as reverseRoute } from "@/app/api/v1/properties/[propertyId]/folio-items/[itemId]/reverse/route";
import { POST as refundRoute } from "@/app/api/v1/properties/[propertyId]/payments/[paymentId]/refund/route";
import { POST as voidRoute } from "@/app/api/v1/properties/[propertyId]/payments/[paymentId]/void/route";
import { GET as historyRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/folio/history/route";
import {
  GET as accountRoute,
  POST as openWindowRoute,
} from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/folio/route";
import { POST as roomChargesRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/room-charges/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as checkOutRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/check-out/route";
import { GET as stayRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/route";
import { prisma } from "@/lib/db/prisma";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import { stayNights } from "@/modules/reservations/reservations.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;
type Handler = typeof chargesRoute;

let org: FixtureOrg;
let A: string;
let B: string;
let invA: Inventory;
let invB: Inventory;
let D: string;
let guestId: string;
let fom: CookieJar; // front office manager @ A: adjust, void, refund, audit
let agent: CookieJar; // front desk agent @ A: post, pay, open windows
let auditor: CookieJar; // auditor @ A: read only
let gmB: CookieJar; // general manager @ B only

const base = (propertyId = A) => `/api/v1/properties/${propertyId}`;
const key = () => `test-${randomUUID()}`;
const cents = (value: string) => formatMoney(parseMoney(value), 2);

function post(
  route: Handler,
  jar: CookieJar,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
  options: { propertyId?: string; idempotencyKey?: string | null } = {},
) {
  const propertyId = options.propertyId ?? A;
  const headers: Record<string, string> = {};
  if (options.idempotencyKey !== null) headers["idempotency-key"] = options.idempotencyKey ?? key();
  return call(route, {
    method: "POST",
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    body,
    jar,
    headers,
  });
}

function get(route: Handler, jar: CookieJar, path: string, params = {}, propertyId = A) {
  return call(route, {
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    jar,
  });
}

const account = (jar: CookieJar, rrId: string, propertyId = A) =>
  get(
    accountRoute,
    jar,
    `/reservation-rooms/${rrId}/folio`,
    { reservationRoomId: rrId },
    propertyId,
  );

async function window1(rrId: string) {
  const r = await account(fom, rrId);
  expect(r.status).toBe(200);
  return r.body.data.windows[0] as { id: string; version: number; balance: string; status: string };
}

const charge = (
  jar: CookieJar,
  folioId: string,
  body: Record<string, unknown>,
  options: { propertyId?: string; idempotencyKey?: string | null } = {},
) => post(chargesRoute, jar, `/folios/${folioId}/charges`, { folioId }, body, options);

const pay = (
  jar: CookieJar,
  folioId: string,
  body: Record<string, unknown>,
  options: { propertyId?: string; idempotencyKey?: string | null } = {},
) => post(paymentsRoute, jar, `/folios/${folioId}/payments`, { folioId }, body, options);

const reverse = (jar: CookieJar, itemId: string, body: Record<string, unknown>, k?: string) =>
  post(reverseRoute, jar, `/folio-items/${itemId}/reverse`, { itemId }, body, {
    idempotencyKey: k,
  });

const adjust = (jar: CookieJar, itemId: string, body: Record<string, unknown>) =>
  post(adjustRoute, jar, `/folio-items/${itemId}/adjust`, { itemId }, body);

const voidPayment = (jar: CookieJar, paymentId: string, body: Record<string, unknown>) =>
  post(voidRoute, jar, `/payments/${paymentId}/void`, { paymentId }, body);

const refund = (jar: CookieJar, paymentId: string, body: Record<string, unknown>) =>
  post(refundRoute, jar, `/payments/${paymentId}/refund`, { paymentId }, body);

const roomCharges = (
  jar: CookieJar,
  rrId: string,
  body: Record<string, unknown> = {},
  k?: string,
) =>
  post(
    roomChargesRoute,
    jar,
    `/reservation-rooms/${rrId}/room-charges`,
    { reservationRoomId: rrId },
    body,
    { idempotencyKey: k },
  );

async function ledgerOf(folioId: string) {
  return prisma.folioItem.findMany({
    where: { folioId },
    orderBy: [{ postedAt: "asc" }, { id: "asc" }],
  });
}

/** Stored folio totals equal the ledger (trigger-maintained). */
async function expectLedgerConsistent(folioId: string) {
  const folio = await prisma.folio.findUniqueOrThrow({ where: { id: folioId } });
  const items = await ledgerOf(folioId);
  const sum = items.reduce((s, i) => s + parseMoney(i.amount.toFixed(4)), 0n);
  expect(parseMoney(folio.balance.toFixed(4))).toBe(sum);
  expect(folio.balance.toFixed(4)).toBe(folio.chargesTotal.add(folio.creditsTotal).toFixed(4));
  return { folio, items, balance: formatMoney(sum, 2) };
}

let roomCursor = 0;
async function book(arrival = D, departure = addDays(D, 2), propertyId = A) {
  const inv = propertyId === A ? invA : invB;
  const r = await post(
    createReservationRoute,
    propertyId === A ? fom : gmB,
    "/reservations",
    {},
    {
      arrival,
      departure,
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
      roomId: inv.roomTypes.KNG!.roomIds[roomCursor++ % inv.roomTypes.KNG!.roomIds.length],
    },
    { propertyId, idempotencyKey: null },
  );
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  return r.body.data.rooms[0] as { id: string; version: number };
}

/** An in-house guest (checked in today); window 1 opened by check-in. */
async function inHouse(propertyId = A) {
  const rr = await book(D, addDays(D, 2), propertyId);
  const r = await post(
    checkInRoute,
    propertyId === A ? agent : gmB,
    `/reservation-rooms/${rr.id}/check-in`,
    { reservationRoomId: rr.id },
    { version: rr.version },
    { propertyId, idempotencyKey: null },
  );
  if (r.status !== 201) throw new Error(`Check-in failed: ${JSON.stringify(r.body)}`);
  return { rrId: rr.id, stay: r.body.data as { id: string; version: number } };
}

/** An in-house guest who arrived `nights` ago and departs today (past nights to post). */
async function withPastNights(nights: number) {
  const guest = await inHouse();
  const arrival = addDays(D, -nights);
  const night = await prisma.reservationRoomNight.findFirstOrThrow({
    where: { reservationRoomId: guest.rrId },
    select: { roomTypeId: true, ratePlanId: true, rateAmount: true, currencyCode: true },
  });
  await prisma.$transaction([
    prisma.reservationRoomNight.deleteMany({ where: { reservationRoomId: guest.rrId } }),
    prisma.reservationRoomNight.createMany({
      data: stayNights(arrival, D).map((d) => ({
        propertyId: A,
        reservationRoomId: guest.rrId,
        stayDate: fromDateOnly(d),
        ...night,
        adults: 1,
        children: 0,
      })),
    }),
    prisma.reservationRoom.update({
      where: { id: guest.rrId },
      data: { arrivalDate: fromDateOnly(arrival), departureDate: fromDateOnly(D) },
    }),
    prisma.roomAssignment.updateMany({
      where: { reservationRoomId: guest.rrId, status: "ACTIVE" },
      data: { fromDate: fromDateOnly(arrival), toDate: fromDateOnly(D) },
    }),
    prisma.stay.updateMany({
      where: { reservationRoomId: guest.rrId },
      data: { arrivalBusinessDate: fromDateOnly(arrival) },
    }),
  ]);
  return { ...guest, rate: cents(night.rateAmount.toFixed(4)) };
}

const FNB = () => invA.chargeCodes["2000"]!;
const MINIBAR = () => invA.chargeCodes["2020"]!;
const CASH = () => invA.paymentMethods.CASH!;
const CARD = () => invA.paymentMethods.CARD!;
const reason = (key: string) => invA.reasonCodes[key]!;

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  // F&B: service charge 10%, then 16% sales tax compounded on it. Room: 16% sales tax.
  invA = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 60 }], {
    taxes: [
      {
        code: "SVC",
        name: "Service charge 10%",
        calculation: "PERCENT",
        basis: "NET",
        rate: "10",
        sequence: 1,
        bucket: "SERVICE_CHARGE",
        appliesTo: ["2000"],
      },
      {
        code: "GST",
        name: "Sales tax 16%",
        calculation: "PERCENT",
        basis: "COMPOUND",
        rate: "16",
        sequence: 2,
        appliesTo: ["1000", "2000"],
      },
    ],
  });
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 4 }]);
  D = invA.businessDate;
  await prisma.room.updateMany({
    where: { propertyId: { in: [A, B] } },
    data: { housekeepingStatus: "INSPECTED", frontOfficeStatus: "VACANT" },
  });
  guestId = (await createGuestRow(org, "Zara", "Billing")).id;

  const users = {
    fom: await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    auditor: await createUser(org, "auditor", [{ role: "AUDITOR", property: "A" }]),
    gmB: await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]),
  };
  fom = await loginAs(users.fom.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
  auditor = await loginAs(users.auditor.email, TEST_PASSWORD);
  gmB = await loginAs(users.gmB.email, TEST_PASSWORD);
});

describe("folios", () => {
  it("opens window 1 at check-in in the property currency", async () => {
    const guest = await inHouse();
    const r = await account(agent, guest.rrId);
    expect(r.status).toBe(200);
    expect(r.body.data.currencyCode).toBe("PKR");
    expect(r.body.data.windows).toHaveLength(1);
    expect(r.body.data.windows[0]).toMatchObject({ window: 1, status: "OPEN", balance: "0.0000" });
    const logs = await auditLogsFor(r.body.data.windows[0].id);
    expect(logs.map((l) => l.action)).toContain("folio.open");

    // A second window needs billing:transfer (agent has it); the auditor cannot open one.
    expect(
      (
        await post(
          openWindowRoute,
          auditor,
          `/reservation-rooms/${guest.rrId}/folio`,
          { reservationRoomId: guest.rrId },
          {},
          { idempotencyKey: null },
        )
      ).status,
    ).toBe(403);
    const opened = await post(
      openWindowRoute,
      agent,
      `/reservation-rooms/${guest.rrId}/folio`,
      { reservationRoomId: guest.rrId },
      {},
      { idempotencyKey: null },
    );
    expect(opened.status).toBe(201);
    expect(opened.body.data.windows.map((w: { window: number }) => w.window)).toEqual([1, 2]);
  });
});

describe("charges and taxes", () => {
  it("posts a manual charge with server-calculated taxes and ledger-maintained totals", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    const body = {
      transactionCodeId: FNB(),
      quantity: 2,
      unitAmount: "500.00",
      reference: "CHK-17",
    };

    const preview = await post(
      previewRoute,
      agent,
      `/folios/${w.id}/charges/preview`,
      { folioId: w.id },
      body,
      { idempotencyKey: null },
    );
    expect(preview.status).toBe(200);
    // 1000 net, service 100, sales tax 16% of 1100 = 176.
    expect(preview.body.data).toMatchObject({
      net: "1000.0000",
      total: "1276.0000",
      balanceAfter: "1276.0000",
      taxes: [
        { code: "SVC", amount: "100.0000" },
        { code: "GST", amount: "176.0000" },
      ],
    });

    const r = await charge(agent, w.id, body);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ total: "1276.0000", balance: "1276.0000" });
    const { items, folio } = await expectLedgerConsistent(w.id);
    expect(items.map((i) => [i.kind, i.amount.toFixed(2)])).toEqual([
      ["CHARGE", "1000.00"],
      ["TAX", "100.00"],
      ["TAX", "176.00"],
    ]);
    expect(items.every((i) => i.currencyCode === "PKR")).toBe(true);
    expect(items[1]!.parentItemId).toBe(items[0]!.id);
    expect(items[0]!.businessDate.toISOString().slice(0, 10)).toBe(D);
    expect(folio.chargesTotal.toFixed(2)).toBe("1276.00");
    const logs = await auditLogsFor(w.id);
    const posted = logs.find((l) => l.action === "folio.post_charge")!;
    expect(posted.after).toMatchObject({ total: "1276.0000", code: "2000", currencyCode: "PKR" });
    expect(posted.businessDate?.toISOString().slice(0, 10)).toBe(D);
  });

  it("rejects client totals, foreign precision, non-postable codes and missing keys", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    const ok = { transactionCodeId: FNB(), quantity: 1, unitAmount: "10.00" };
    expect((await charge(agent, w.id, { ...ok, total: "1.00" })).status).toBe(400);
    expect((await charge(agent, w.id, { ...ok, unitAmount: "10.005" })).status).toBe(400);
    const room = await charge(agent, w.id, { ...ok, transactionCodeId: invA.chargeCodes["1000"] });
    expect(room.status).toBe(422);
    expect(room.body.error.details.reason).toBe("CODE_NOT_POSTABLE");
    const taxCode = await charge(agent, w.id, {
      ...ok,
      transactionCodeId: invA.chargeCodes["8000"],
    });
    expect(taxCode.status).toBe(422);
    expect((await charge(agent, w.id, ok, { idempotencyKey: null })).status).toBe(400);
    expect((await ledgerOf(w.id)).length).toBe(0);
  });

  it("is idempotent: a repeated key replays, a reused key with another body conflicts", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    const k = key();
    const body = { transactionCodeId: MINIBAR(), quantity: 1, unitAmount: "450.00" };
    const [first, second] = await Promise.all([
      charge(agent, w.id, body, { idempotencyKey: k }),
      charge(agent, w.id, body, { idempotencyKey: k }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data).toEqual(first.body.data);
    const replay = await charge(agent, w.id, body, { idempotencyKey: k });
    expect(replay.body.data).toEqual(first.body.data);
    expect((await ledgerOf(w.id)).filter((i) => i.kind === "CHARGE")).toHaveLength(1);

    const conflict = await charge(
      agent,
      w.id,
      { ...body, unitAmount: "451.00" },
      { idempotencyKey: k },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("refuses postings while night audit holds the business date", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    await prisma.businessDate.updateMany({
      where: { propertyId: A, isCurrent: true },
      data: { status: "IN_AUDIT" },
    });
    try {
      const r = await charge(agent, w.id, { transactionCodeId: FNB(), unitAmount: "10.00" });
      expect(r.status).toBe(423);
      expect(r.body.error.code).toBe("BUSINESS_DATE_LOCKED");
    } finally {
      await prisma.businessDate.updateMany({
        where: { propertyId: A, isCurrent: true },
        data: { status: "OPEN" },
      });
    }
  });
});

describe("room charges", () => {
  it("posts each past night once, deterministically, with taxes", async () => {
    const guest = await withPastNights(2);
    const tooFar = await roomCharges(agent, guest.rrId, { through: D });
    expect(tooFar.status).toBe(422);
    expect(tooFar.body.error.details.reason).toBe("NIGHT_NOT_OVER");

    // Two different requests at once: the reservation-room lock serializes them.
    const [a, b] = await Promise.all([
      roomCharges(agent, guest.rrId),
      roomCharges(fom, guest.rrId),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 422]);
    const winner = a.status === 201 ? a : b;
    expect(winner.body.data.postedNights).toEqual([addDays(D, -2), addDays(D, -1)]);

    const w = await window1(guest.rrId);
    const { items, balance } = await expectLedgerConsistent(w.id);
    const charges = items.filter((i) => i.kind === "CHARGE");
    expect(charges).toHaveLength(2);
    expect(charges.map((c) => c.postingKey)).toEqual([
      `ROOM:${guest.rrId}:${addDays(D, -2)}:1`,
      `ROOM:${guest.rrId}:${addDays(D, -1)}:1`,
    ]);
    expect(charges.map((c) => c.revenueDate?.toISOString().slice(0, 10))).toEqual([
      addDays(D, -2),
      addDays(D, -1),
    ]);
    const rate = parseMoney(guest.rate);
    const expected = 2n * (rate + (rate * 16n) / 100n);
    expect(balance).toBe(formatMoney(expected, 2));
    const nights = await prisma.reservationRoomNight.findMany({
      where: { reservationRoomId: guest.rrId },
    });
    expect(nights.every((n) => n.postedAt !== null)).toBe(true);

    const again = await roomCharges(agent, guest.rrId);
    expect(again.status).toBe(422);
    expect(again.body.error.details.reason).toBe("NOTHING_TO_POST");
  });

  it("posts a package booked on the reservation on top of the room charge (Phase 6)", async () => {
    // BB is INCLUDED_IN_RATE for rate plans that include it; booked on a BAR
    // stay it is an add-on and must not be carved out of the room line.
    const guest = await withPastNights(1);
    const night = addDays(D, -1);
    await prisma.reservationPackage.create({
      data: {
        propertyId: A,
        reservationRoomId: guest.rrId,
        packageId: invA.packages.BB!,
        quantity: 1,
        startDate: fromDateOnly(night),
        endDate: fromDateOnly(night),
      },
    });
    const posted = await roomCharges(agent, guest.rrId);
    expect(posted.status).toBe(201);
    const { items } = await expectLedgerConsistent((await window1(guest.rrId)).id);
    const charges = items.filter((i) => i.kind === "CHARGE");
    const room = charges.find((c) => c.postingKey?.startsWith("ROOM:"));
    const breakfast = charges.find((c) => c.transactionCodeId === invA.chargeCodes["2030"]);
    expect(cents(room!.amount.toFixed(4))).toBe(guest.rate);
    expect(breakfast!.amount.toFixed(2)).toBe("1500.00");
  });

  it("re-posts a reversed night with the next generation", async () => {
    const guest = await withPastNights(1);
    expect((await roomCharges(agent, guest.rrId)).status).toBe(201);
    const w = await window1(guest.rrId);
    const room = (await ledgerOf(w.id)).find((i) => i.kind === "CHARGE")!;
    const r = await reverse(fom, room.id, {
      reason: "Wrong rate applied",
      reasonCodeId: reason("VOID:ERR"),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.balance).toBe("0.0000");
    const night = await prisma.reservationRoomNight.findFirstOrThrow({
      where: { reservationRoomId: guest.rrId },
    });
    expect(night.postedAt).toBeNull();

    expect((await roomCharges(agent, guest.rrId)).status).toBe(201);
    const keys = (await ledgerOf(w.id)).filter((i) => i.kind === "CHARGE").map((i) => i.postingKey);
    expect(keys).toEqual([
      `ROOM:${guest.rrId}:${addDays(D, -1)}:1`,
      `ROOM:${guest.rrId}:${addDays(D, -1)}:2`,
    ]);
    await expectLedgerConsistent(w.id);
  });
});

describe("corrections", () => {
  async function chargedWindow(unitAmount = "1000.00") {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    const r = await charge(agent, w.id, { transactionCodeId: FNB(), unitAmount });
    expect(r.status).toBe(201);
    return { guest, folioId: w.id, chargeId: r.body.data.itemIds[0] as string };
  }

  it("reverses a same-day charge and its taxes exactly once (billing:adjust, HIGH)", async () => {
    const { folioId, chargeId } = await chargedWindow();
    expect((await reverse(agent, chargeId, { reason: "Posted to wrong guest" })).status).toBe(403);
    expect((await reverse(fom, chargeId, {})).status).toBe(400); // reason required
    const r = await reverse(fom, chargeId, { reason: "Posted to wrong guest" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ total: "-1276.0000", balance: "0.0000" });
    const again = await reverse(fom, chargeId, { reason: "Posted to wrong guest" });
    expect(again.status).toBe(422);
    const { items } = await expectLedgerConsistent(folioId);
    expect(items.filter((i) => i.kind === "REVERSAL")).toHaveLength(3);
    const log = (await auditLogsFor(folioId)).find((l) => l.action === "folio.reverse")!;
    expect(log.risk).toBe("HIGH");
    expect(log.reason).toBe("Posted to wrong guest");
  });

  it("adjusts part of a charge proportionally and never beyond what remains", async () => {
    const { folioId, chargeId } = await chargedWindow();
    const noReason = await adjust(fom, chargeId, { amount: "638.00", reason: "Guest complaint" });
    expect(noReason.status).toBe(400);
    const r = await adjust(fom, chargeId, {
      amount: "638.00",
      reasonCodeId: reason("ADJUSTMENT:SVC"),
      reason: "Cold food, half credited",
    });
    expect(r.status).toBe(201);
    expect(r.body.data.balance).toBe("638.0000");
    const adjustments = (await ledgerOf(folioId)).filter((i) => i.kind === "ADJUSTMENT");
    expect(adjustments.map((i) => i.amount.toFixed(2))).toEqual(["-500.00", "-50.00", "-88.00"]);
    const tooMuch = await adjust(fom, chargeId, {
      amount: "638.01",
      reasonCodeId: reason("ADJUSTMENT:SVC"),
      reason: "Too much",
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details.reason).toBe("ADJUSTMENT_EXCEEDS_CHARGE");
    // An adjusted charge is not reversed any more.
    expect((await reverse(fom, chargeId, { reason: "Changed my mind" })).status).toBe(422);
    await expectLedgerConsistent(folioId);
  });
});

describe("payments", () => {
  async function owing(amount = "1000.00") {
    const guest = await inHouse();
    let w = await window1(guest.rrId);
    const r = await charge(agent, w.id, { transactionCodeId: MINIBAR(), unitAmount: amount });
    expect(r.status).toBe(201);
    w = await window1(guest.rrId);
    return { guest, w };
  }

  it("takes a payment that lowers the ledger balance and records a receipt", async () => {
    const { w } = await owing();
    const r = await pay(agent, w.id, { methodId: CASH(), amount: "400.00", version: w.version });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ amount: "400.0000", balance: "600.0000" });
    expect(r.body.data.receiptNumber).toMatch(/^R\d+$/);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: r.body.data.paymentId },
    });
    expect(payment).toMatchObject({ status: "CAPTURED", kind: "PAYMENT", currencyCode: "PKR" });
    const { folio } = await expectLedgerConsistent(w.id);
    expect(folio.creditsTotal.toFixed(2)).toBe("-400.00");
    const log = (await auditLogsFor(w.id)).find((l) => l.action === "folio.payment")!;
    expect(log.risk).toBe("HIGH");
    expect(log.after).toMatchObject({ amount: "400.0000", method: "CASH", balance: "600.0000" });
  });

  it("refuses over-payment, stale balances, other currencies and missing references", async () => {
    const { w } = await owing("300.00");
    const over = await pay(agent, w.id, { methodId: CASH(), amount: "300.01", version: w.version });
    expect(over.status).toBe(422);
    expect(over.body.error.details.reason).toBe("PAYMENT_EXCEEDS_BALANCE");
    const stale = await pay(agent, w.id, {
      methodId: CASH(),
      amount: "100.00",
      version: w.version - 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({
      reason: "BALANCE_CHANGED",
      balance: "300.0000",
    });
    const eur = await pay(agent, w.id, {
      methodId: CASH(),
      amount: "100.00",
      version: w.version,
      currencyCode: "EUR",
    });
    expect(eur.status).toBe(422);
    expect(eur.body.error.details.reason).toBe("CURRENCY_NOT_SUPPORTED");
    const card = await pay(agent, w.id, { methodId: CARD(), amount: "100.00", version: w.version });
    expect(card.status).toBe(400);
    expect(
      (await pay(auditor, w.id, { methodId: CASH(), amount: "1.00", version: w.version })).status,
    ).toBe(403);
    expect(await prisma.payment.count({ where: { folioId: w.id } })).toBe(0);
  });

  it("lets only one of two concurrent full payments settle the same balance", async () => {
    const { w } = await owing("100.00");
    const [a, b] = await Promise.all([
      pay(agent, w.id, { methodId: CASH(), amount: "100.00", version: w.version }),
      pay(fom, w.id, { methodId: CASH(), amount: "100.00", version: w.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const { balance } = await expectLedgerConsistent(w.id);
    expect(balance).toBe("0.00");
    expect(await prisma.payment.count({ where: { folioId: w.id } })).toBe(1);

    // Even with a fresh version, nothing is left to pay.
    const fresh = await window1(
      (await prisma.folio.findUniqueOrThrow({ where: { id: w.id } })).reservationRoomId!,
    );
    const extra = await pay(agent, w.id, {
      methodId: CASH(),
      amount: "0.01",
      version: fresh.version,
    });
    expect(extra.status).toBe(422);
  });

  it("records one payment for two identical concurrent requests", async () => {
    const { w } = await owing("250.00");
    const k = key();
    const body = { methodId: CASH(), amount: "250.00", version: w.version };
    const [a, b] = await Promise.all([
      pay(agent, w.id, body, { idempotencyKey: k }),
      pay(agent, w.id, body, { idempotencyKey: k }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.paymentId).toBe(b.body.data.paymentId);
    expect(await prisma.payment.count({ where: { folioId: w.id } })).toBe(1);
  });

  it("stays consistent when a payment races a new charge", async () => {
    for (let round = 0; round < 3; round++) {
      const { w } = await owing("500.00");
      const [payment, posted] = await Promise.all([
        pay(agent, w.id, { methodId: CASH(), amount: "500.00", version: w.version }),
        charge(fom, w.id, { transactionCodeId: MINIBAR(), unitAmount: "80.00" }),
      ]);
      expect(posted.status).toBe(201);
      const { balance } = await expectLedgerConsistent(w.id);
      if (payment.status === 201) expect(balance).toBe("80.00");
      else {
        expect(payment.status).toBe(409);
        expect(balance).toBe("580.00");
      }
    }
  });

  it("stays consistent when a payment races a reversal", async () => {
    for (let round = 0; round < 3; round++) {
      const { w } = await owing("500.00");
      const chargeId = (await ledgerOf(w.id)).find((i) => i.kind === "CHARGE")!.id;
      const [payment, reversal] = await Promise.all([
        pay(agent, w.id, { methodId: CASH(), amount: "500.00", version: w.version }),
        reverse(fom, chargeId, { reason: "Minibar not consumed" }),
      ]);
      expect(reversal.status).toBe(201);
      const { balance } = await expectLedgerConsistent(w.id);
      // Paid first → the reversal leaves a credit; reversed first → the payment is refused.
      if (payment.status === 201) expect(balance).toBe("-500.00");
      else {
        expect(payment.status).toBe(409);
        expect(balance).toBe("0.00");
      }
    }
  });
});

describe("voids and refunds", () => {
  async function paid(amount = "600.00") {
    const guest = await inHouse();
    let w = await window1(guest.rrId);
    await charge(agent, w.id, { transactionCodeId: MINIBAR(), unitAmount: amount });
    w = await window1(guest.rrId);
    const r = await pay(agent, w.id, { methodId: CASH(), amount, version: w.version });
    expect(r.status).toBe(201);
    return { guest, folioId: w.id, paymentId: r.body.data.paymentId as string };
  }

  it("voids a same-day payment once, restoring the balance (payments:void)", async () => {
    const { folioId, paymentId } = await paid();
    expect((await voidPayment(agent, paymentId, { reason: "Wrong folio" })).status).toBe(403);
    const r = await voidPayment(fom, paymentId, {
      reason: "Wrong folio",
      reasonCodeId: reason("VOID:ERR"),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.balance).toBe("600.0000");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      "VOIDED",
    );
    expect((await voidPayment(fom, paymentId, { reason: "Again" })).status).toBe(422);
    expect(
      (
        await refund(fom, paymentId, {
          amount: "1.00",
          reasonCodeId: reason("REFUND:OVER"),
          reason: "x x x",
        })
      ).status,
    ).toBe(422);
    await expectLedgerConsistent(folioId);
  });

  it("refunds against the original payment, never above what remains", async () => {
    const { folioId, paymentId } = await paid();
    const noReason = await refund(fom, paymentId, { amount: "100.00", reason: "Partial refund" });
    expect(noReason.status).toBe(400);
    expect(
      (
        await refund(agent, paymentId, {
          amount: "100.00",
          reasonCodeId: reason("REFUND:GOOD"),
          reason: "Goodwill",
        })
      ).status,
    ).toBe(403);
    const r = await refund(fom, paymentId, {
      amount: "150.00",
      reasonCodeId: reason("REFUND:GOOD"),
      reason: "Goodwill for noise",
    });
    expect(r.status).toBe(201);
    expect(r.body.data.balance).toBe("150.0000");
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { refunds: true },
    });
    expect(payment.refundedAmount.toFixed(2)).toBe("150.00");
    expect(payment.refunds).toHaveLength(1);
    expect(payment.refunds[0]).toMatchObject({ status: "SUCCEEDED", currencyCode: "PKR" });
    const over = await refund(fom, paymentId, {
      amount: "450.01",
      reasonCodeId: reason("REFUND:GOOD"),
      reason: "Too much",
    });
    expect(over.status).toBe(422);
    // A partly refunded payment can no longer be voided.
    expect((await voidPayment(fom, paymentId, { reason: "Void it" })).status).toBe(422);
    const log = (await auditLogsFor(folioId)).find((l) => l.action === "folio.refund")!;
    expect(log.risk).toBe("HIGH");
    await expectLedgerConsistent(folioId);
  });
});

describe("settlement and financial check-out", () => {
  it("settles only a zero window, once, and a new posting reopens it", async () => {
    const guest = await inHouse();
    let w = await window1(guest.rrId);
    await charge(agent, w.id, { transactionCodeId: MINIBAR(), unitAmount: "90.00" });
    w = await window1(guest.rrId);
    const early = await post(
      settleRoute,
      agent,
      `/folios/${w.id}/settle`,
      { folioId: w.id },
      { version: w.version },
      { idempotencyKey: null },
    );
    expect(early.status).toBe(422);
    await pay(agent, w.id, { methodId: CASH(), amount: "90.00", version: w.version });
    w = await window1(guest.rrId);
    const [a, b] = await Promise.all([
      post(
        settleRoute,
        agent,
        `/folios/${w.id}/settle`,
        { folioId: w.id },
        { version: w.version },
        { idempotencyKey: null },
      ),
      post(
        settleRoute,
        fom,
        `/folios/${w.id}/settle`,
        { folioId: w.id },
        { version: w.version },
        { idempotencyKey: null },
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await prisma.folio.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("SETTLED");
    expect((await auditLogsFor(w.id)).filter((l) => l.action === "folio.settle")).toHaveLength(1);

    await charge(agent, w.id, { transactionCodeId: MINIBAR(), unitAmount: "5.00" });
    const reopened = await prisma.folio.findUniqueOrThrow({ where: { id: w.id } });
    expect(reopened).toMatchObject({ status: "OPEN", settledAt: null });
  });

  it("refuses check-out with a balance and settles the windows once paid", async () => {
    const guest = await withPastNights(1);
    expect((await roomCharges(agent, guest.rrId)).status).toBe(201);
    const stay = (await get(stayRoute, agent, `/stays/${guest.stay.id}`, { stayId: guest.stay.id }))
      .body.data;
    expect(stay.folio.balance).not.toBe("0.0000");
    const blocked = await post(
      checkOutRoute,
      agent,
      `/stays/${guest.stay.id}/check-out`,
      { stayId: guest.stay.id },
      { version: stay.version },
      { idempotencyKey: null },
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.reason).toBe("FOLIO_BALANCE_OUTSTANDING");
    expect((await prisma.stay.findUniqueOrThrow({ where: { id: guest.stay.id } })).status).toBe(
      "IN_HOUSE",
    );

    const w = await window1(guest.rrId);
    const paid = await pay(agent, w.id, {
      methodId: CASH(),
      amount: w.balance,
      version: w.version,
    });
    expect(paid.status).toBe(201);
    const done = await post(
      checkOutRoute,
      agent,
      `/stays/${guest.stay.id}/check-out`,
      { stayId: guest.stay.id },
      { version: stay.version },
      { idempotencyKey: null },
    );
    expect(done.status).toBe(200);
    expect((await prisma.folio.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("SETTLED");
    const log = (await auditLogsFor(guest.stay.id)).find((l) => l.action === "stay.check_out")!;
    expect(log.after).toMatchObject({ folio: { windows: 1, balance: "0.0000", settled: [1] } });
  });

  it("allows check-out with a balance only when the property does not require zero", async () => {
    await prisma.propertyConfiguration.upsert({
      where: { propertyId: A },
      update: { requireZeroBalanceCheckout: false },
      create: { propertyId: A, requireZeroBalanceCheckout: false },
    });
    try {
      const guest = await withPastNights(1);
      expect((await roomCharges(agent, guest.rrId)).status).toBe(201);
      const r = await post(
        checkOutRoute,
        agent,
        `/stays/${guest.stay.id}/check-out`,
        { stayId: guest.stay.id },
        { version: guest.stay.version },
        { idempotencyKey: null },
      );
      expect(r.status).toBe(200);
      const w = await prisma.folio.findFirstOrThrow({ where: { reservationRoomId: guest.rrId } });
      expect(w.status).toBe("OPEN"); // not settled: the balance is still owed
    } finally {
      await prisma.propertyConfiguration.update({
        where: { propertyId: A },
        data: { requireZeroBalanceCheckout: true },
      });
    }
  });
});

describe("security and isolation", () => {
  it("keeps folios property-scoped without disclosing other properties' records", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    // Through property B's path (where gmB has access): not found.
    expect((await account(gmB, guest.rrId, B)).status).toBe(404);
    expect((await get(itemsRoute, gmB, `/folios/${w.id}/items`, { folioId: w.id }, B)).status).toBe(
      404,
    );
    const crossPay = await pay(
      gmB,
      w.id,
      { methodId: invB.paymentMethods.CASH, amount: "1.00", version: 1 },
      { propertyId: B },
    );
    expect(crossPay.status).toBe(404);
    const crossCharge = await charge(
      gmB,
      w.id,
      { transactionCodeId: invB.chargeCodes["2000"], unitAmount: "1.00" },
      { propertyId: B },
    );
    expect(crossCharge.status).toBe(404);
    // Through property A's path: no access at all.
    expect((await account(gmB, guest.rrId, A)).status).toBe(403);
    expect(await prisma.folioItem.count({ where: { folioId: w.id } })).toBe(0);
  });

  it("lets read-only users read but not post, and shows history only with audit:read", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    const view = await account(auditor, guest.rrId);
    expect(view.status).toBe(200);
    expect(view.body.data.actions).toMatchObject({
      postCharge: false,
      takePayment: false,
      reverse: false,
    });
    expect(
      (await charge(auditor, w.id, { transactionCodeId: FNB(), unitAmount: "1.00" })).status,
    ).toBe(403);
    expect((await roomCharges(auditor, guest.rrId)).status).toBe(403);
    const history = (jar: CookieJar) =>
      get(historyRoute, jar, `/reservation-rooms/${guest.rrId}/folio/history`, {
        reservationRoomId: guest.rrId,
      });
    expect((await history(auditor)).status).toBe(200);
    expect((await history(agent)).status).toBe(403);
    // Through another property's path the stay does not exist (no empty-list probing).
    const crossHistory = await get(
      historyRoute,
      gmB,
      `/reservation-rooms/${guest.rrId}/folio/history`,
      { reservationRoomId: guest.rrId },
      B,
    );
    expect(crossHistory.status).toBe(404);
    const list = await get(foliosRoute, auditor, "/folios?view=in_house", {});
    expect(list.status).toBe(200);
  });

  it("serves the ledger with a database running balance and keyset pages", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    for (const amount of ["10.00", "20.00", "30.00"]) {
      await charge(agent, w.id, { transactionCodeId: MINIBAR(), unitAmount: amount });
    }
    const page1 = await call(itemsRoute, {
      path: `${base()}/folios/${w.id}/items?limit=2`,
      params: { propertyId: A, folioId: w.id },
      jar: agent,
    });
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.nextCursor).not.toBeNull();
    const page2 = await call(itemsRoute, {
      path: `${base()}/folios/${w.id}/items?limit=10&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
      params: { propertyId: A, folioId: w.id },
      jar: agent,
    });
    const all = [...page1.body.data.items, ...page2.body.data.items];
    expect(all.map((i: { runningBalance: string }) => i.runningBalance)).toEqual([
      "10.0000",
      "30.0000",
      "60.0000",
    ]);
  });

  it("enforces ledger integrity in the database itself", async () => {
    const guest = await inHouse();
    const w = await window1(guest.rrId);
    const r = await charge(agent, w.id, { transactionCodeId: MINIBAR(), unitAmount: "70.00" });
    const itemId = r.body.data.itemIds[0] as string;
    await expect(
      prisma.$executeRaw`UPDATE folios SET balance = 0, charges_total = 0 WHERE id = ${w.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE folio_items SET amount = 1 WHERE id = ${itemId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM folio_items WHERE id = ${itemId}::uuid`,
    ).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM folios WHERE id = ${w.id}::uuid`).rejects.toThrow();
    // A "reversal" that does not negate the original exactly.
    await expect(
      prisma.folioItem.create({
        data: {
          propertyId: A,
          folioId: w.id,
          kind: "REVERSAL",
          source: "MANUAL",
          transactionCodeId: MINIBAR(),
          businessDate: fromDateOnly(D),
          quantity: -1,
          unitAmount: "70.00",
          amount: "-60.00",
          currencyCode: "PKR",
          description: "bad",
          correctsItemId: itemId,
        },
      }),
    ).rejects.toThrow();
    // A posting in another currency.
    await expect(
      prisma.folioItem.create({
        data: {
          propertyId: A,
          folioId: w.id,
          kind: "CHARGE",
          source: "MANUAL",
          transactionCodeId: MINIBAR(),
          businessDate: fromDateOnly(D),
          unitAmount: "1.00",
          amount: "1.00",
          currencyCode: "USD",
          description: "bad",
        },
      }),
    ).rejects.toThrow();
    const { balance } = await expectLedgerConsistent(w.id);
    expect(balance).toBe("70.00");
  });
});
