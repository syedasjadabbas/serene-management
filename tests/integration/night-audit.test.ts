import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  GET as runsRoute,
  POST as startRoute,
} from "@/app/api/v1/properties/[propertyId]/night-audits/route";
import { GET as readinessRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/readiness/route";
import { GET as runRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/[runId]/route";
import { POST as recoverRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/[runId]/recover/route";
import { POST as chargesRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/charges/route";
import { GET as accountRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/folio/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { POST as reinstateNoShowRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/reinstate-no-show/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as extendRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/extend/route";
import { PATCH as configurationRoute } from "@/app/api/v1/properties/[propertyId]/configuration/route";
import { POST as checkOutRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/check-out/route";
import { prisma } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { ALL_PERMISSIONS } from "@/lib/permissions/catalog";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { addDays, fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { COMMIT_STEPS } from "@/modules/night-audit/night-audit.policy";
import { sumMoneyForDate } from "@/modules/night-audit/night-audit.repository";
import { recoverRun, startNightAudit } from "@/modules/night-audit/night-audit.service";
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

/**
 * Night audit (Phase 8): checks, the single commit transaction, failure at
 * every step, retries, concurrency with postings, recovery, statistics and
 * the business-date roll.
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;
type Handler = typeof chargesRoute;

let org: FixtureOrg;
let A: string;
let B: string;
let C: string;
let invA: Inventory;
let invB: Inventory;
let DA: string;
let DB: string;
let guestId: string;
let fom: CookieJar; // front office manager @ A and B: runs the audit
let agent: CookieJar; // front desk agent @ A: operates, cannot run the audit
let auditor: CookieJar; // auditor @ A: reads the audit

const key = () => `na-${randomUUID()}`;
const base = (propertyId: string) => `/api/v1/properties/${propertyId}`;

function post(
  route: Handler,
  jar: CookieJar,
  propertyId: string,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
  idempotencyKey: string | null = null,
) {
  return call(route, {
    method: "POST",
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    body,
    jar,
    headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
  });
}

function get(route: Handler, jar: CookieJar, propertyId: string, path: string, params = {}) {
  return call(route, {
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    jar,
  });
}

const readiness = (jar: CookieJar, propertyId: string) =>
  get(readinessRoute as Handler, jar, propertyId, "/night-audits/readiness");

const start = (
  jar: CookieJar,
  propertyId: string,
  k: string | null = key(),
  reason = "End of day",
) => post(startRoute as Handler, jar, propertyId, "/night-audits", {}, { reason }, k);

function propertyCtx(propertyId: string, timezone: string, businessDate: string): PropertyContext {
  return {
    ...org.adminCtx,
    access: { ...org.adminCtx.access, byProperty: { [propertyId]: ALL_PERMISSIONS } },
    propertyId,
    propertyCode: "TEST",
    timezone,
    currencyCode: "PKR",
    businessDate,
  };
}

let roomCursor = 0;
async function book(
  propertyId: string,
  arrival: string,
  departure: string,
  type: "GTD" | "TENT" | "6PM" = "GTD",
) {
  const inv = propertyId === A ? invA : invB;
  const rooms = inv.roomTypes.KNG!.roomIds;
  const r = await post(
    createReservationRoute as Handler,
    fom,
    propertyId,
    "/reservations",
    {},
    {
      arrival,
      departure,
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes[type]!,
      guestId,
      ...(type === "TENT" ? {} : { roomId: rooms[roomCursor++ % rooms.length] }),
    },
  );
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  return r.body.data.rooms[0] as { id: string; version: number };
}

async function inHouse(propertyId: string, D: string, nights = 2) {
  const rr = await book(propertyId, D, addDays(D, nights));
  const r = await post(
    checkInRoute as Handler,
    fom,
    propertyId,
    `/reservation-rooms/${rr.id}/check-in`,
    { reservationRoomId: rr.id },
    { version: rr.version },
  );
  if (r.status !== 201) throw new Error(`Check-in failed: ${JSON.stringify(r.body)}`);
  return { rrId: rr.id, stay: r.body.data as { id: string; version: number } };
}

/** An in-house guest who arrived `nightsBefore` ago, departing on `departure` (history rewritten). */
async function arrivedEarlier(
  propertyId: string,
  D: string,
  nightsBefore: number,
  departure: string,
) {
  const guest = await inHouse(propertyId, D, 1);
  const arrival = addDays(D, -nightsBefore);
  const night = await prisma.reservationRoomNight.findFirstOrThrow({
    where: { reservationRoomId: guest.rrId },
    select: { roomTypeId: true, ratePlanId: true, rateAmount: true, currencyCode: true },
  });
  await prisma.$transaction([
    prisma.reservationRoomNight.deleteMany({ where: { reservationRoomId: guest.rrId } }),
    prisma.reservationRoomNight.createMany({
      data: stayNights(arrival, departure).map((d) => ({
        propertyId,
        reservationRoomId: guest.rrId,
        stayDate: fromDateOnly(d),
        ...night,
        adults: 1,
        children: 0,
      })),
    }),
    prisma.reservationRoom.update({
      where: { id: guest.rrId },
      data: { arrivalDate: fromDateOnly(arrival), departureDate: fromDateOnly(departure) },
    }),
    prisma.roomAssignment.updateMany({
      where: { reservationRoomId: guest.rrId, status: "ACTIVE" },
      data: { fromDate: fromDateOnly(arrival), toDate: fromDateOnly(departure) },
    }),
    prisma.stay.updateMany({
      where: { reservationRoomId: guest.rrId },
      data: { arrivalBusinessDate: fromDateOnly(arrival) },
    }),
  ]);
  const stay = await prisma.stay.findFirstOrThrow({
    where: { reservationRoomId: guest.rrId },
    select: { id: true, version: true },
  });
  return { rrId: guest.rrId, stay, rate: night.rateAmount.toFixed(4) };
}

async function currentDate(propertyId: string) {
  const row = await prisma.businessDate.findFirstOrThrow({
    where: { propertyId, isCurrent: true },
    select: { date: true, status: true },
  });
  return { date: toDateOnly(row.date), status: row.status };
}

const ledgerCount = (propertyId: string) => prisma.folioItem.count({ where: { propertyId } });

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
      { key: "C", timezone: "Asia/Karachi" },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  C = org.properties.C!.id;
  const taxes = [
    {
      code: "GST",
      name: "Sales tax 16%",
      calculation: "PERCENT" as const,
      basis: "NET" as const,
      rate: "16",
      sequence: 1,
      appliesTo: ["1000", "1090"],
    },
  ];
  invA = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 30 }], { taxes });
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 12 }], { taxes });
  await buildFixtureInventory(org, "C", [{ code: "KNG", rooms: 4 }], { taxes });
  DA = invA.businessDate;
  DB = invB.businessDate;
  await prisma.room.updateMany({
    where: { propertyId: { in: [A, B] } },
    data: { housekeepingStatus: "INSPECTED", frontOfficeStatus: "VACANT" },
  });
  guestId = (await createGuestRow(org, "Nadia", "Audit")).id;
  const users = {
    fom: await createUser(org, "fom", [
      { role: "FRONT_OFFICE_MANAGER", property: "A" },
      { role: "FRONT_OFFICE_MANAGER", property: "B" },
      { role: "FRONT_OFFICE_MANAGER", property: "C" },
    ]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    auditor: await createUser(org, "auditor", [{ role: "AUDITOR", property: "A" }]),
  };
  fom = await loginAs(users.fom.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
  auditor = await loginAs(users.auditor.email, TEST_PASSWORD);
});

describe("access", () => {
  it("lets auditors read and only night-audit holders run", async () => {
    expect((await readiness(auditor, A)).status).toBe(200);
    expect((await readiness(agent, A)).status).toBe(403);
    const byAgent = await start(agent, A);
    expect(byAgent.status).toBe(403);
    const byAuditor = await start(auditor, A);
    expect(byAuditor.status).toBe(403);
    // Another property is invisible.
    expect((await readiness(auditor, B)).status).toBe(403);
    expect(await prisma.nightAuditRun.count({ where: { propertyId: A } })).toBe(0);
  });

  it("accepts only a revenue fee code and a no-show reason in the configuration", async () => {
    const admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
    const patch = (body: Record<string, unknown>) =>
      call(configurationRoute as Handler, {
        method: "PATCH",
        path: `${base(A)}/configuration`,
        params: { propertyId: A },
        body: { reason: "Night audit settings", ...body },
        jar: admin,
      });
    const payment = await patch({ noShowTransactionCodeId: invA.chargeCodes["9000"]! });
    expect(payment.status).toBe(400);
    expect(payment.body.error.details.fields.noShowTransactionCodeId).toBeDefined();
    const wrongReason = await patch({
      noShowReasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"]!,
    });
    expect(wrongReason.status).toBe(400);
    const ok = await patch({
      noShowTransactionCodeId: invA.chargeCodes["1090"]!,
      noShowReasonCodeId: invA.reasonCodes["NO_SHOW:AUTO"]!,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      noShowTransactionCodeId: invA.chargeCodes["1090"],
      noShowReasonCodeId: invA.reasonCodes["NO_SHOW:AUTO"],
    });
  });

  it("requires a reason and an Idempotency-Key", async () => {
    const noReason = await post(startRoute as Handler, fom, A, "/night-audits", {}, {}, key());
    expect(noReason.status).toBe(400);
    const noKey = await start(fom, A, null);
    expect(noKey.status).toBe(400);
    expect((await currentDate(A)).status).toBe("OPEN");
  });
});

describe("blocking checks", () => {
  it("fails before posting anything while a guest due out is still in house", async () => {
    const overstay = await arrivedEarlier(A, DA, 1, DA);
    const ready = await readiness(fom, A);
    expect(ready.status).toBe(200);
    const departures = ready.body.data.checks.find(
      (c: { code: string }) => c.code === "VALIDATE_DEPARTURES",
    );
    expect(departures.outcome).toBe("BLOCKING");
    expect(ready.body.data.canStart).toBe(false);

    const before = await ledgerCount(A);
    const r = await start(fom, A);
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("FAILED");
    expect(r.body.data.errorCode).toBe("PRE_CHECK_FAILED");
    expect(await ledgerCount(A)).toBe(before);
    expect(await currentDate(A)).toEqual({ date: DA, status: "OPEN" });
    const failedStep = r.body.data.steps.find(
      (s: { code: string }) => s.code === "VALIDATE_DEPARTURES",
    );
    expect(failedStep.status).toBe("FAILED");
    // Commit steps never ran.
    expect(
      r.body.data.steps
        .filter((s: { code: string; status: string }) =>
          (COMMIT_STEPS as readonly string[]).includes(s.code),
        )
        .every((s: { status: string }) => s.status === "PENDING"),
    ).toBe(true);

    // Extending the stay resolves it: the added night is priced and sold.
    const extended = await post(
      extendRoute as Handler,
      fom,
      A,
      `/stays/${overstay.stay.id}/extend`,
      { stayId: overstay.stay.id },
      { version: overstay.stay.version, departure: addDays(DA, 1) },
    );
    expect(extended.status).toBe(200);
    const nights = await prisma.reservationRoomNight.findMany({
      where: { reservationRoomId: overstay.rrId },
      orderBy: { stayDate: "asc" },
    });
    expect(nights.map((n) => toDateOnly(n.stayDate))).toEqual([addDays(DA, -1), DA]);
    const again = await readiness(fom, A);
    expect(
      again.body.data.checks.find((c: { code: string }) => c.code === "VALIDATE_DEPARTURES")
        .outcome,
    ).toBe("PASSED");
  });

  it("refuses to extend beyond the room's next booking", async () => {
    const guest = await inHouse(A, DA, 1);
    const room = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: guest.rrId },
      select: { roomId: true },
    });
    // Someone else holds the same room tomorrow.
    const next = await post(
      createReservationRoute as Handler,
      fom,
      A,
      "/reservations",
      {},
      {
        arrival: addDays(DA, 1),
        departure: addDays(DA, 3),
        adults: 1,
        roomTypeId: invA.roomTypes.KNG!.id,
        ratePlanId: invA.ratePlans.BAR!,
        reservationTypeId: invA.reservationTypes.GTD!,
        guestId,
        roomId: room.roomId,
      },
    );
    expect(next.status).toBe(201);
    const r = await post(
      extendRoute as Handler,
      fom,
      A,
      `/stays/${guest.stay.id}/extend`,
      { stayId: guest.stay.id },
      { version: guest.stay.version, departure: addDays(DA, 2) },
    );
    expect(r.status).toBe(409);
  });
});

describe("failure at every commit step (property B)", () => {
  it("rolls everything back, keeps the date open and retries as a new attempt", async () => {
    const guest = await inHouse(B, DB, 3);
    const noShow = await book(B, DB, addDays(DB, 2));
    const ctx = propertyCtx(B, "Asia/Dubai", DB);
    const before = await ledgerCount(B);
    let attempt = 0;
    for (const code of COMMIT_STEPS) {
      attempt += 1;
      const run = await startNightAudit(
        ctx,
        { reason: `Inject at ${code}` },
        { key: key(), route: "POST /test", requestHash: "b".repeat(64) },
        {
          hooks: {
            beforeStep: (step) => {
              if (step === code) throw new Error(`injected at ${code}`);
            },
          },
        },
      );
      expect(run.status).toBe("FAILED");
      expect(run.attempt).toBe(attempt);
      expect(run.steps.find((s) => s.code === code)!.status).toBe("FAILED");
      expect(await ledgerCount(B)).toBe(before);
      expect(await currentDate(B)).toEqual({ date: DB, status: "OPEN" });
      expect(await prisma.dailyStatistic.count({ where: { propertyId: B } })).toBe(0);
      const rr = await prisma.reservationRoom.findUniqueOrThrow({
        where: { id: noShow.id },
        select: { status: true },
      });
      expect(rr.status).toBe("RESERVED");
      const posted = await prisma.reservationRoomNight.count({
        where: { reservationRoomId: guest.rrId, postedAt: { not: null } },
      });
      expect(posted).toBe(0);
    }
    // A clean retry succeeds and posts exactly once.
    const run = await startNightAudit(
      ctx,
      { reason: "Retry" },
      {
        key: key(),
        route: "POST /test",
        requestHash: "c".repeat(64),
      },
    );
    expect(run.status).toBe("COMPLETED");
    expect(run.attempt).toBe(COMMIT_STEPS.length + 1);
    expect(await currentDate(B)).toEqual({ date: addDays(DB, 1), status: "OPEN" });
    const lines = await prisma.folioItem.findMany({
      where: { originReservationRoomId: guest.rrId, kind: "CHARGE" },
    });
    expect(lines.map((l) => l.postingKey)).toEqual([`ROOM:${guest.rrId}:${DB}:1`]);
    expect(lines[0]!.source).toBe("NIGHT_AUDIT");
    // Every run is on record, attempt by attempt.
    const runs = await prisma.nightAuditRun.findMany({
      where: { propertyId: B, businessDate: fromDateOnly(DB) },
      orderBy: { attempt: "asc" },
      select: { attempt: true, status: true },
    });
    expect(runs.map((r) => r.status)).toEqual([...COMMIT_STEPS.map(() => "FAILED"), "COMPLETED"]);
  });
});

/** A few nights later: the audit may close a date only once the hotel's calendar has reached it. */
const later = () => new Date(Date.now() + 3 * 24 * 3_600_000);

describe("concurrency", () => {
  it("lets exactly one of two simultaneous starts run (property C)", async () => {
    const date = (await currentDate(C)).date;
    const [first, second] = await Promise.all([start(fom, C), start(fom, C)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    // Running (it overlapped the first run's check phase) or already closed
    // (it waited for the first run's commit): never a second run.
    expect(["NIGHT_AUDIT_RUNNING", "BUSINESS_DATE_CHANGED"]).toContain(
      loser.body.error.details.reason,
    );
    const winner = first.status === 201 ? first : second;
    expect(winner.body.data.status).toBe("COMPLETED");
    expect(winner.body.data.businessDate).toBe(date);
    expect(await currentDate(C)).toEqual({ date: addDays(date, 1), status: "OPEN" });
    expect(await prisma.nightAuditRun.count({ where: { propertyId: C } })).toBe(1);
    // The next date cannot be closed before the hotel's calendar reaches it.
    const ahead = await start(fom, C);
    expect(ahead.status).toBe(422);
    expect(ahead.body.error.details.reason).toBe("DATE_AHEAD");
  });

  it("refuses a start that waited through another run's commit (property B)", async () => {
    const date = (await currentDate(B)).date;
    const ctx = propertyCtx(B, "Asia/Dubai", date);
    let waiting: ReturnType<typeof start> | undefined;
    const run = await startNightAudit(
      ctx,
      { reason: "First" },
      { key: key(), route: "POST /test", requestHash: "f".repeat(64) },
      {
        now: later(),
        hooks: {
          beforeStep: async (step) => {
            if (step !== "POST_ROOM_AND_TAX") return;
            // The second start queues behind the commit's lock on the business date.
            waiting = start(fom, B);
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
        },
      },
    );
    expect(run.status).toBe("COMPLETED");
    const second = await waiting!;
    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe("BUSINESS_DATE_CHANGED");
    expect(
      await prisma.nightAuditRun.count({
        where: { propertyId: B, businessDate: fromDateOnly(date), status: "COMPLETED" },
      }),
    ).toBe(1);
  });

  it("answers a posting that waited through the roll with 423 BUSINESS_DATE_CHANGED (property B)", async () => {
    const date = (await currentDate(B)).date;
    const guest = await inHouse(B, date, 3);
    const account = await get(
      accountRoute as Handler,
      fom,
      B,
      `/reservation-rooms/${guest.rrId}/folio`,
      { reservationRoomId: guest.rrId },
    );
    const folioId = account.body.data.windows[0].id as string;
    const ctx = propertyCtx(B, "Asia/Dubai", date);
    let waiting: ReturnType<typeof post> | undefined;
    const run = await startNightAudit(
      ctx,
      { reason: "Roll race" },
      { key: key(), route: "POST /test", requestHash: "d".repeat(64) },
      {
        now: later(),
        hooks: {
          beforeStep: async (step) => {
            if (step !== "CLOSE_DATE") return;
            // The charge queues behind the audit's lock on the business date.
            waiting = post(
              chargesRoute,
              fom,
              B,
              `/folios/${folioId}/charges`,
              { folioId },
              { transactionCodeId: invB.chargeCodes["2000"]!, unitAmount: "10.00" },
              key(),
            );
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
        },
      },
    );
    expect(run.status).toBe("COMPLETED");
    const r = await waiting!;
    expect(r.status).toBe(423);
    expect(r.body.error.details.reason).toBe("BUSINESS_DATE_CHANGED");
    // A fresh request posts on the new date.
    const retried = await post(
      chargesRoute,
      fom,
      B,
      `/folios/${folioId}/charges`,
      { folioId },
      { transactionCodeId: invB.chargeCodes["2000"]!, unitAmount: "10.00" },
      key(),
    );
    expect(retried.status).toBe(201);
    const item = await prisma.folioItem.findFirstOrThrow({
      where: { folioId, kind: "CHARGE", transactionCodeId: invB.chargeCodes["2000"]! },
      select: { businessDate: true },
    });
    expect(toDateOnly(item.businessDate)).toBe(addDays(date, 1));
  });

  it("recovers a stale run left by an interruption, never a fresh one (property B)", async () => {
    const current = await prisma.businessDate.findFirstOrThrow({
      where: { propertyId: B, isCurrent: true },
      select: { id: true, date: true },
    });
    const date = toDateOnly(current.date);
    // Simulate a crash between the phases: RUNNING run, date IN_AUDIT.
    await prisma.businessDate.update({ where: { id: current.id }, data: { status: "IN_AUDIT" } });
    const attempt =
      (await prisma.nightAuditRun.count({ where: { propertyId: B, businessDate: current.date } })) +
      1;
    const crashed = await prisma.nightAuditRun.create({
      data: {
        propertyId: B,
        businessDate: current.date,
        attempt,
        status: "RUNNING",
        startedById: org.adminId,
      },
    });
    // While it holds the date, postings are locked.
    const blocked = await start(fom, B);
    expect(blocked.status).toBe(409);
    const tooSoon = await post(
      recoverRoute as Handler,
      fom,
      B,
      `/night-audits/${crashed.id}/recover`,
      { runId: crashed.id },
      { reason: "Crash" },
    );
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.details.reason).toBe("RUN_NOT_STALE");
    const recovered = await recoverRun(
      propertyCtx(B, "Asia/Dubai", date),
      crashed.id,
      { reason: "Server restarted during the audit" },
      new Date(Date.now() + 10 * 60_000),
    );
    expect(recovered.status).toBe("FAILED");
    expect(recovered.errorCode).toBe("RECOVERED");
    expect(await currentDate(B)).toEqual({ date, status: "OPEN" });
    const logs = await auditLogsFor(crashed.id);
    expect(logs.some((l) => l.action === "nightaudit.recover" && l.risk === "HIGH")).toBe(true);
    // A finished run is history: it can never change again.
    await expect(
      prisma.nightAuditRun.update({ where: { id: crashed.id }, data: { status: "COMPLETED" } }),
    ).rejects.toThrow();
  });
});

describe("closing the day (property A)", () => {
  let result: {
    runId: string;
    inHouse: { rrId: string; stay: { id: string; version: number } };
    earlier: Awaited<ReturnType<typeof arrivedEarlier>>;
    guaranteed: { id: string };
    tentative: { id: string };
    runKey: string;
  };

  beforeAll(async () => {
    // Resolve every blocker left by earlier tests (departures due today are
    // extended by the blocking-checks test; check out anything else due).
    const inHouseGuest = await inHouse(A, DA, 3);
    const earlier = await arrivedEarlier(A, DA, 2, addDays(DA, 2));
    const guaranteed = await book(A, DA, addDays(DA, 2), "GTD");
    const tentative = await book(A, DA, addDays(DA, 2), "TENT");
    const runKey = key();
    const r = await start(fom, A, runKey, "End of day");
    if (r.status !== 201 || r.body.data.status !== "COMPLETED") {
      throw new Error(`Audit failed: ${JSON.stringify(r.body)}`);
    }
    result = {
      runId: r.body.data.id,
      inHouse: inHouseGuest,
      earlier,
      guaranteed,
      tentative,
      runKey,
    };
  });

  it("closes D and opens D+1", async () => {
    expect(await currentDate(A)).toEqual({ date: addDays(DA, 1), status: "OPEN" });
    const closed = await prisma.businessDate.findFirstOrThrow({
      where: { propertyId: A, date: fromDateOnly(DA) },
    });
    expect(closed.status).toBe("CLOSED");
    expect(closed.isCurrent).toBe(false);
    expect(closed.closedAt).not.toBeNull();
    const run = await get(runRoute as Handler, auditor, A, `/night-audits/${result.runId}`, {
      runId: result.runId,
    });
    expect(run.status).toBe(200);
    expect(run.body.data.steps).toHaveLength(14);
    expect(run.body.data.steps.at(-1).code).toBe("CLOSE_DATE");
    expect(run.body.data.steps.at(-1).status).toBe("SUCCEEDED");
    expect(
      run.body.data.steps.find((s: { code: string }) => s.code === "VALIDATE_CASHIERS").status,
    ).toBe("SKIPPED");
  });

  it("posts tonight's room charge and the missed earlier nights, with tax, once", async () => {
    const lines = await prisma.folioItem.findMany({
      where: { originReservationRoomId: result.inHouse.rrId },
      orderBy: { postedAt: "asc" },
    });
    const charge = lines.find((l) => l.kind === "CHARGE")!;
    expect(charge.postingKey).toBe(`ROOM:${result.inHouse.rrId}:${DA}:1`);
    expect(charge.source).toBe("NIGHT_AUDIT");
    expect(toDateOnly(charge.businessDate)).toBe(DA);
    expect(toDateOnly(charge.revenueDate!)).toBe(DA);
    const tax = lines.find((l) => l.kind === "TAX")!;
    expect(formatMoney(parseMoney(tax.amount.toFixed(4)))).toBe(
      formatMoney((parseMoney(charge.amount.toFixed(4)) * 16n) / 100n),
    );
    // Catch-up: both earlier nights of the guest who arrived before go-live, and tonight.
    const earlier = await prisma.folioItem.findMany({
      where: { originReservationRoomId: result.earlier.rrId, kind: "CHARGE" },
      orderBy: { revenueDate: "asc" },
    });
    expect(earlier.map((l) => toDateOnly(l.revenueDate!))).toEqual([
      addDays(DA, -2),
      addDays(DA, -1),
      DA,
    ]);
    const unposted = await prisma.reservationRoomNight.count({
      where: {
        reservationRoomId: { in: [result.inHouse.rrId, result.earlier.rrId] },
        stayDate: { lte: fromDateOnly(DA) },
        postedAt: null,
      },
    });
    expect(unposted).toBe(0);
  });

  it("turns missed arrivals into no-shows and charges the guaranteed one", async () => {
    const [gtd, tent] = await Promise.all(
      [result.guaranteed.id, result.tentative.id].map((id) =>
        prisma.reservationRoom.findUniqueOrThrow({
          where: { id },
          select: { status: true, noShowBusinessDate: true },
        }),
      ),
    );
    expect(gtd!.status).toBe("NO_SHOW");
    expect(toDateOnly(gtd!.noShowBusinessDate!)).toBe(DA);
    expect(tent!.status).toBe("NO_SHOW");
    const fee = await prisma.folioItem.findMany({
      where: { originReservationRoomId: result.guaranteed.id },
      orderBy: { kind: "asc" },
    });
    expect(fee.find((l) => l.kind === "CHARGE")!.postingKey).toBe(
      `NOSHOW:${result.guaranteed.id}:1`,
    );
    expect(fee.some((l) => l.kind === "TAX")).toBe(true);
    expect(
      await prisma.folioItem.count({ where: { originReservationRoomId: result.tentative.id } }),
    ).toBe(0);
    const logs = await auditLogsFor(result.guaranteed.id);
    const noShow = logs.find((l) => l.action === "reservation.no_show")!;
    expect(noShow.actorType).toBe("SYSTEM");
    expect(noShow.risk).toBe("HIGH");
  });

  it("reinstates a no-show from the new business date", async () => {
    const rr = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: result.guaranteed.id },
      select: { version: true },
    });
    const r = await post(
      reinstateNoShowRoute as Handler,
      fom,
      A,
      `/reservation-rooms/${result.guaranteed.id}/reinstate-no-show`,
      { reservationRoomId: result.guaranteed.id },
      { version: rr.version, reason: "Guest arrived late" },
    );
    expect(r.status).toBe(200);
    const after = await prisma.reservationRoom.findUniqueOrThrow({
      where: { id: result.guaranteed.id },
      select: { status: true, arrivalDate: true, noShowBusinessDate: true },
    });
    expect(after.status).toBe("RESERVED");
    expect(toDateOnly(after.arrivalDate)).toBe(addDays(DA, 1));
    expect(after.noShowBusinessDate).toBeNull();
    const nights = await prisma.reservationRoomNight.findMany({
      where: { reservationRoomId: result.guaranteed.id },
    });
    expect(nights.map((n) => toDateOnly(n.stayDate))).toEqual([addDays(DA, 1)]);
  });

  it("rolls occupied rooms to dirty and plans tomorrow's stayovers", async () => {
    const stay = await prisma.stay.findFirstOrThrow({
      where: { reservationRoomId: result.inHouse.rrId },
      select: { roomId: true },
    });
    const room = await prisma.room.findUniqueOrThrow({
      where: { id: stay.roomId },
      select: { housekeepingStatus: true },
    });
    expect(room.housekeepingStatus).toBe("DIRTY");
    const history = await prisma.roomStatusHistory.findFirst({
      where: { roomId: stay.roomId, source: "NIGHT_AUDIT" },
    });
    expect(history?.toValue).toBe("DIRTY");
    const task = await prisma.housekeepingTask.findFirst({
      where: { roomId: stay.roomId, businessDate: fromDateOnly(addDays(DA, 1)) },
      include: { taskType: true },
    });
    expect(task?.taskType.code).toBe("STAY");
  });

  it("freezes statistics that match a recomputation, with the ledger roll-forward", async () => {
    const stats = await prisma.dailyStatistic.findUniqueOrThrow({
      where: { propertyId_businessDate: { propertyId: A, businessDate: fromDateOnly(DA) } },
    });
    expect(stats.noShows).toBe(2);
    expect(stats.roomsSold).toBeGreaterThanOrEqual(3);
    expect(stats.currencyCode).toBe("PKR");
    const recomputed = await prisma.$transaction((tx) => sumMoneyForDate(tx, A, DA, null));
    expect(stats.taxTotal.toFixed(4)).toBe(parseMoneyText(recomputed.tax_total));
    const dayLedger = await prisma.folioItem.aggregate({
      where: { propertyId: A, businessDate: fromDateOnly(DA) },
      _sum: { amount: true },
    });
    expect(stats.ledgerClosing.sub(stats.ledgerOpening).toFixed(4)).toBe(
      (dayLedger._sum.amount ?? stats.ledgerOpening.sub(stats.ledgerOpening)).toFixed(4),
    );
    expect(stats.noShowRevenue.greaterThan(0)).toBe(true);
    // Snapshots are frozen.
    await expect(
      prisma.dailyStatistic.update({
        where: { propertyId_businessDate: { propertyId: A, businessDate: fromDateOnly(DA) } },
        data: { roomsSold: 0 },
      }),
    ).rejects.toThrow();
  });

  it("never accepts a posting for the closed date", async () => {
    const folio = await prisma.folio.findFirstOrThrow({
      where: { reservationRoomId: result.inHouse.rrId },
      select: { id: true },
    });
    await expect(
      prisma.folioItem.create({
        data: {
          propertyId: A,
          folioId: folio.id,
          kind: "CHARGE",
          source: "MANUAL",
          transactionCodeId: invA.chargeCodes["2000"]!,
          businessDate: fromDateOnly(DA),
          unitAmount: "1.00",
          amount: "1.00",
          currencyCode: "PKR",
          description: "back-dated",
        },
      }),
    ).rejects.toThrow();
    // Through the service, postings now carry D+1.
    const r = await post(
      chargesRoute,
      agent,
      A,
      `/folios/${folio.id}/charges`,
      { folioId: folio.id },
      { transactionCodeId: invA.chargeCodes["2000"]!, unitAmount: "5.00" },
      key(),
    );
    expect(r.status).toBe(201);
    const item = await prisma.folioItem.findFirstOrThrow({
      where: { folioId: folio.id, transactionCodeId: invA.chargeCodes["2000"]! },
    });
    expect(toDateOnly(item.businessDate)).toBe(addDays(DA, 1));
  });

  it("replays the same request instead of running twice", async () => {
    const r = await start(fom, A, result.runKey, "End of day");
    expect(r.status).toBe(201);
    expect(r.body.data.id).toBe(result.runId);
    expect(await currentDate(A)).toEqual({ date: addDays(DA, 1), status: "OPEN" });
  });

  it("records HIGH audit rows for the run and the date close", async () => {
    const runLogs = await auditLogsFor(result.runId);
    expect(runLogs.map((l) => l.action)).toEqual(
      expect.arrayContaining(["nightaudit.start", "nightaudit.run"]),
    );
    expect(runLogs.every((l) => l.risk === "HIGH")).toBe(true);
    const closed = await prisma.businessDate.findFirstOrThrow({
      where: { propertyId: A, date: fromDateOnly(DA) },
      select: { id: true },
    });
    const dateLogs = await auditLogsFor(closed.id);
    expect(dateLogs.some((l) => l.action === "business_date.close" && l.risk === "HIGH")).toBe(
      true,
    );
  });

  it("lists the run history newest first", async () => {
    const r = await get(runsRoute as Handler, auditor, A, "/night-audits");
    expect(r.status).toBe(200);
    expect(r.body.data[0].id).toBe(result.runId);
    expect(r.body.data[0].status).toBe("COMPLETED");
  });

  it("requires posted nights before check-out", async () => {
    // Tonight (D+1) is not posted until the next audit; earlier nights are.
    const stay = await prisma.stay.findFirstOrThrow({
      where: { reservationRoomId: result.earlier.rrId },
      select: { id: true, version: true },
    });
    const r = await post(
      checkOutRoute as Handler,
      fom,
      A,
      `/stays/${stay.id}/check-out`,
      { stayId: stay.id },
      {
        version: stay.version,
        earlyDeparture: true,
        reasonCodeId: invA.reasonCodes["EARLY_DEPARTURE:PLANS"]!,
      },
    );
    // All nights before D+1 are posted, so the rule passes; the balance rule decides.
    expect([200, 422]).toContain(r.status);
    if (r.status === 422) expect(r.body.error.details.reason).toBe("FOLIO_BALANCE_OUTSTANDING");
  });
});

function parseMoneyText(value: string): string {
  return formatMoney(parseMoney(value));
}
