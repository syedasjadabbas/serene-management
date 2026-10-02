import { randomUUID } from "node:crypto";
import net from "node:net";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as businessDateRoute } from "@/app/api/v1/properties/[propertyId]/business-date/route";
import { GET as availabilityRoute } from "@/app/api/v1/properties/[propertyId]/availability/route";
import { GET as dashboardRoute } from "@/app/api/v1/properties/[propertyId]/dashboard/route";
import { POST as chargesRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/charges/route";
import { GET as arrivalsRoute } from "@/app/api/v1/properties/[propertyId]/front-desk/arrivals/route";
import { POST as startAuditRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/route";
import { GET as exportRoute } from "@/app/api/v1/properties/[propertyId]/reports/[reportKey]/export/route";
import { GET as reportRoute } from "@/app/api/v1/properties/[propertyId]/reports/[reportKey]/route";
import { GET as folioRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/folio/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { GET as reservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/[reservationId]/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { GET as boardRoute } from "@/app/api/v1/properties/[propertyId]/rooms/board/route";
import { GET as orgPerformanceRoute } from "@/app/api/v1/organization/reports/performance/route";
import { prisma } from "@/lib/db/prisma";
import { serverEnv } from "@/lib/env";
import { type HealthProbe, configureReadReplica, readFromReplica } from "@/lib/db/read-replica";
import { addDays } from "@/modules/business-date/business-date.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";
import { drainJobs } from "./support/jobs";

/**
 * Read-replica routing (scalability phase 7, docs/SCALABILITY.md §35). There
 * is no physical replica in this environment: the "replica" here is a second
 * pool to the same test database, with a stubbed health probe. That validates
 * the routing, fallback and isolation code paths, not replication itself.
 */

type Handler = typeof chargesRoute;
const TEST_DB = process.env.DATABASE_URL!;
const UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:1/none";
const healthy: HealthProbe = async () => ({ standby: true, lagMs: 0 });
const appName = async (db: typeof prisma) =>
  (await db.$queryRaw<{ a: string }[]>`SELECT current_setting('application_name') AS "a"`)[0]!.a;

afterAll(async () => {
  await configureReadReplica(null);
});

describe("routing primitives", () => {
  it("uses the primary when no replica is configured", async () => {
    await configureReadReplica(null);
    const r = await readFromReplica(true, appName);
    expect(r).toEqual({ value: "serene-management", route: "primary" });
  });

  it("sends only eligible reads to a healthy replica", async () => {
    await configureReadReplica({ url: TEST_DB, probe: healthy });
    expect(await readFromReplica(true, appName)).toEqual({
      value: "serene-management-read",
      route: "replica",
    });
    expect(await readFromReplica(false, appName)).toEqual({
      value: "serene-management",
      route: "primary",
    });
  });

  it("falls back to the primary when the replica lags beyond the limit", async () => {
    await configureReadReplica({
      url: TEST_DB,
      maxLagMs: 30_000,
      probe: async () => ({ standby: true, lagMs: 120_000 }),
    });
    expect(await readFromReplica(true, appName)).toEqual({
      value: "serene-management",
      route: "fallback",
    });
  });

  it("falls back when the replica is unreachable, and does not retry it on every read", async () => {
    await configureReadReplica({ url: UNREACHABLE });
    const first = await readFromReplica(true, appName);
    expect(first).toEqual({ value: "serene-management", route: "fallback" });
    const started = performance.now();
    expect((await readFromReplica(true, appName)).route).toBe("fallback");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("falls back when the replica's health check does not answer (connection timeout)", async () => {
    await configureReadReplica({ url: TEST_DB, probe: () => new Promise(() => undefined) });
    const started = performance.now();
    expect((await readFromReplica(true, appName)).route).toBe("fallback");
    expect(performance.now() - started).toBeLessThan(3_500);
  });

  it("falls back when the replica database does not exist", async () => {
    const url = new URL(TEST_DB);
    url.pathname = `/serene_missing_${randomUUID().slice(0, 8)}`;
    await configureReadReplica({ url: url.toString() });
    expect((await readFromReplica(true, appName)).route).toBe("fallback");
  });

  it("re-runs a read on the primary when the replica fails during it; other errors propagate", async () => {
    await configureReadReplica({ url: TEST_DB, probe: healthy });
    const lost = Object.assign(new Error("terminating connection due to conflict with recovery"), {
      code: "57P01",
    });
    const r = await readFromReplica(true, async (db) => {
      if (db !== prisma) throw lost;
      return appName(db);
    });
    expect(r).toEqual({ value: "serene-management", route: "fallback" });

    await configureReadReplica({ url: TEST_DB, probe: healthy });
    await expect(
      readFromReplica(true, async () => {
        throw new Error("not a connection problem");
      }),
    ).rejects.toThrow("not a connection problem");
  });

  it("abandons a replica read that never answers (silent network drop) and uses the primary", async () => {
    // Deadline = statement timeout + 5 s; shortened here so the test takes ~5 s.
    const env = serverEnv() as { DATABASE_STATEMENT_TIMEOUT_MS: number };
    const saved = env.DATABASE_STATEMENT_TIMEOUT_MS;
    env.DATABASE_STATEMENT_TIMEOUT_MS = 100;
    try {
      await configureReadReplica({ url: TEST_DB, probe: healthy });
      const started = Date.now();
      const r = await readFromReplica(true, async (db) =>
        db === prisma ? appName(db) : new Promise<string>(() => {}),
      );
      expect(r).toEqual({ value: "serene-management", route: "fallback" });
      expect(Date.now() - started).toBeLessThan(8_000);
      // The replica is now considered unhealthy: the next read goes straight to the primary.
      const next = await readFromReplica(true, async (db) =>
        db === prisma ? "primary" : "replica",
      );
      expect(next).toEqual({ value: "primary", route: "fallback" });
    } finally {
      env.DATABASE_STATEMENT_TIMEOUT_MS = saved;
    }
  }, 15_000);
});

describe("application paths", () => {
  let org: FixtureOrg;
  let other: FixtureOrg;
  let A: string;
  let B: string;
  let D: string;
  let inv: Awaited<ReturnType<typeof buildFixtureInventory>>;
  let guestId: string;
  let fom: CookieJar;
  let agent: CookieJar;
  let gmB: CookieJar;
  let outsider: CookieJar;
  let replicaCheckouts = 0;
  let roomCursor = 0;

  const base = (propertyId: string) => `/api/v1/properties/${propertyId}`;
  const get = (route: unknown, jar: CookieJar, path: string, params: Record<string, string>) =>
    call(route as Handler, { path, params, jar });
  const post = (
    route: unknown,
    jar: CookieJar,
    path: string,
    params: Record<string, string>,
    body: Record<string, unknown>,
  ) =>
    call(route as Handler, {
      method: "POST",
      path,
      params,
      body,
      jar,
      headers: { "idempotency-key": `rr-${randomUUID()}` },
    });
  const report = (jar: CookieJar, key: string, from: string, to: string, propertyId = A) =>
    get(reportRoute, jar, `${base(propertyId)}/reports/${key}?from=${from}&to=${to}`, {
      propertyId,
      reportKey: key,
    });
  async function exportCsv(key: string, from: string, to: string) {
    const request = new NextRequest(
      new URL(`${base(A)}/reports/${key}/export?from=${from}&to=${to}`, "http://localhost:3000"),
      { headers: { cookie: fom.header(), "x-forwarded-for": "198.18.7.7" } },
    );
    const response = await (exportRoute as Handler)(request, {
      params: Promise.resolve({ propertyId: A, reportKey: key }),
    });
    return { status: response.status, text: await response.text() };
  }
  async function book(arrival: string) {
    const r = await post(
      createReservationRoute,
      fom,
      `${base(A)}/reservations`,
      { propertyId: A },
      {
        arrival,
        departure: addDays(arrival, 2),
        adults: 1,
        roomTypeId: inv.roomTypes.KNG!.id,
        ratePlanId: inv.ratePlans.BAR!,
        reservationTypeId: inv.reservationTypes.GTD!,
        guestId,
        roomId: inv.roomTypes.KNG!.roomIds[roomCursor++],
      },
    );
    expect(r.status).toBe(201);
    return r.body.data as { id: string; rooms: { id: string; version: number }[] };
  }
  async function checkIn(room: { id: string; version: number }) {
    const r = await post(
      checkInRoute,
      fom,
      `${base(A)}/reservation-rooms/${room.id}/check-in`,
      { propertyId: A, reservationRoomId: room.id },
      { version: room.version },
    );
    expect(r.status).toBe(201);
    const folio = await get(folioRoute, fom, `${base(A)}/reservation-rooms/${room.id}/folio`, {
      propertyId: A,
      reservationRoomId: room.id,
    });
    return folio.body.data.windows[0] as { id: string; version: number; balance: string };
  }
  const withoutGenerated = (body: { data: Record<string, unknown> }) => ({
    ...body.data,
    generatedAt: null,
  });

  beforeAll(async () => {
    org = await createFixtureOrg({
      properties: [
        { key: "A", timezone: "Asia/Karachi" },
        { key: "B", timezone: "Asia/Karachi" },
      ],
    });
    other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
    A = org.properties.A!.id;
    B = org.properties.B!.id;
    inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 8 }]);
    await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }]);
    D = inv.businessDate;
    await prisma.room.updateMany({
      where: { propertyId: A },
      data: { housekeepingStatus: "INSPECTED", frontOfficeStatus: "VACANT" },
    });
    guestId = (await createGuestRow(org, "Rida", "Replica")).id;
    const users = {
      fom: await createUser(org, "rr-fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]),
      agent: await createUser(org, "rr-agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
      gmB: await createUser(org, "rr-gmb", [{ role: "GENERAL_MANAGER", property: "B" }]),
      outsider: await createUser(other, "rr-out", [{ role: "GENERAL_MANAGER", property: "X" }]),
    };
    fom = await loginAs(users.fom.email, TEST_PASSWORD);
    agent = await loginAs(users.agent.email, TEST_PASSWORD);
    gmB = await loginAs(users.gmB.email, TEST_PASSWORD);
    outsider = await loginAs(users.outsider.email, TEST_PASSWORD);

    // Close D with one guest in house and a restaurant charge: D becomes a closed date.
    const folio = await checkIn((await book(D)).rooms[0]!);
    const charge = await post(
      chargesRoute,
      fom,
      `${base(A)}/folios/${folio.id}/charges`,
      { propertyId: A, folioId: folio.id },
      { transactionCodeId: inv.chargeCodes["2000"]!, unitAmount: "80.00" },
    );
    expect(charge.status).toBe(201);
    const audit = await post(
      startAuditRoute,
      fom,
      `${base(A)}/night-audits`,
      { propertyId: A },
      { reason: "Close for replica tests" },
    );
    expect(audit.status).toBe(202);
    await drainJobs(A);
    expect(
      (await prisma.nightAuditRun.findUniqueOrThrow({ where: { id: audit.body.data.id } })).status,
    ).toBe("COMPLETED");

    await configureReadReplica({
      url: TEST_DB,
      probe: healthy,
      onAcquire: () => {
        replicaCheckouts += 1;
      },
    });
  }, 180_000);

  it("keeps writes and every consistency-sensitive read on the primary (read-your-writes)", async () => {
    const today = addDays(D, 1);
    const before = replicaCheckouts;

    // Create, then read straight back.
    const created = await book(today);
    const read = await get(reservationRoute, fom, `${base(A)}/reservations/${created.id}`, {
      propertyId: A,
      reservationId: created.id,
    });
    expect(read.status).toBe(200);
    expect(read.body.data.id).toBe(created.id);

    // Check in, then the folio and the room board reflect it at once.
    const folio = await checkIn(created.rooms[0]!);
    const charged = await post(
      chargesRoute,
      fom,
      `${base(A)}/folios/${folio.id}/charges`,
      { propertyId: A, folioId: folio.id },
      { transactionCodeId: inv.chargeCodes["2000"]!, unitAmount: "12.50" },
    );
    expect(charged.status).toBe(201);
    const account = await get(
      folioRoute,
      fom,
      `${base(A)}/reservation-rooms/${created.rooms[0]!.id}/folio`,
      { propertyId: A, reservationRoomId: created.rooms[0]!.id },
    );
    expect(account.body.data.windows[0].balance).not.toBe(folio.balance);
    const roomId = inv.roomTypes.KNG!.roomIds[roomCursor - 1]!;
    const board = await get(boardRoute, fom, `${base(A)}/rooms/board?limit=200`, {
      propertyId: A,
    });
    expect(board.status).toBe(200);
    const row = (board.body.data.items as { id: string; frontOfficeStatus: string }[]).find(
      (r) => r.id === roomId,
    );
    expect(row?.frontOfficeStatus).toBe("OCCUPIED");

    const date = await get(businessDateRoute, fom, `${base(A)}/business-date`, { propertyId: A });
    expect(date.body.data.businessDate).toBe(today);
    expect(
      (
        await get(
          availabilityRoute,
          fom,
          `${base(A)}/availability?arrival=${today}&departure=${addDays(today, 1)}&adults=1`,
          { propertyId: A },
        )
      ).status,
    ).toBe(200);
    expect(
      (await get(arrivalsRoute, fom, `${base(A)}/front-desk/arrivals`, { propertyId: A })).status,
    ).toBe(200);
    expect((await get(dashboardRoute, fom, `${base(A)}/dashboard`, { propertyId: A })).status).toBe(
      200,
    );
    // Reports that reach the open date, or show live state, stay on the primary too.
    expect((await report(fom, "revenue-by-code", D, today)).status).toBe(200);
    expect((await report(fom, "in-house", D, D)).status).toBe(200);
    expect((await report(fom, "room-status", D, D)).status).toBe(200);

    expect(replicaCheckouts).toBe(before);
  });

  it("serves closed-date reports from the replica with exactly the primary's result", async () => {
    for (const key of ["revenue-by-code", "manager-flash", "occupancy", "payments", "tax"]) {
      const before = replicaCheckouts;
      const viaReplica = await report(fom, key, D, D);
      expect(viaReplica.status).toBe(200);
      expect(replicaCheckouts).toBeGreaterThan(before);
      await configureReadReplica(null);
      const viaPrimary = await report(fom, key, D, D);
      await configureReadReplica({
        url: TEST_DB,
        probe: healthy,
        onAcquire: () => {
          replicaCheckouts += 1;
        },
      });
      expect(withoutGenerated(viaReplica.body)).toEqual(withoutGenerated(viaPrimary.body));
    }
  });

  it("exports closed-date CSV from the replica, identical to the primary's", async () => {
    const before = replicaCheckouts;
    const viaReplica = await exportCsv("revenue-by-code", D, D);
    expect(viaReplica.status).toBe(200);
    expect(replicaCheckouts).toBeGreaterThan(before);
    await configureReadReplica(null);
    const viaPrimary = await exportCsv("revenue-by-code", D, D);
    expect(viaReplica.text).toBe(viaPrimary.text);
    await configureReadReplica({
      url: TEST_DB,
      probe: healthy,
      onAcquire: () => {
        replicaCheckouts += 1;
      },
    });
  });

  it("serves the organization performance of closed dates from the replica", async () => {
    const before = replicaCheckouts;
    const r = await get(
      orgPerformanceRoute,
      fom,
      `/api/v1/organization/reports/performance?from=${D}&to=${D}`,
      {},
    );
    expect(r.status).toBe(200);
    expect(replicaCheckouts).toBeGreaterThan(before);
  });

  it("authorizes before any replica read: permissions, property and organization isolation", async () => {
    const before = replicaCheckouts;
    // No reports:financial-level report for a front desk agent.
    expect((await report(agent, "revenue-by-code", D, D)).status).toBe(403);
    // Another property's manager, and another organization's.
    expect((await report(gmB, "revenue-by-code", D, D)).status).toBe(403);
    expect((await report(outsider, "revenue-by-code", D, D)).status).toBe(403);
    expect(replicaCheckouts).toBe(before);
    // Property B's own closed range never contains A's data.
    const own = await report(gmB, "revenue-by-code", D, D, B);
    expect(JSON.stringify(own.body)).not.toContain(inv.chargeCodes["2000"]!);
  });

  it("answers closed-date reports from the primary when the replica is down", async () => {
    await configureReadReplica(null);
    const viaPrimary = await report(fom, "revenue-by-code", D, D);
    await configureReadReplica({ url: UNREACHABLE });
    const duringOutage = await report(fom, "revenue-by-code", D, D);
    expect(duringOutage.status).toBe(200);
    expect(withoutGenerated(duringOutage.body)).toEqual(withoutGenerated(viaPrimary.body));
  });

  it("does not let a silently dropped replica hold the heavy-report slot (final phase)", async () => {
    // A TCP relay to the test database that, once stalled, accepts bytes and never answers:
    // a network partition without a reset.
    let stalled = false;
    const sockets: net.Socket[] = [];
    const relay = net.createServer((client) => {
      const upstream = net.connect(
        Number(new URL(TEST_DB).port || 5432),
        new URL(TEST_DB).hostname,
      );
      client.on("data", (d) => !stalled && upstream.write(d));
      upstream.on("data", (d) => !stalled && client.write(d));
      for (const s of [client, upstream]) {
        s.on("error", () => undefined);
        sockets.push(s);
      }
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const relayUrl = new URL(TEST_DB);
    relayUrl.hostname = "127.0.0.1";
    relayUrl.port = String((relay.address() as net.AddressInfo).port);
    const env = serverEnv() as { DATABASE_STATEMENT_TIMEOUT_MS: number };
    const saved = env.DATABASE_STATEMENT_TIMEOUT_MS;
    try {
      await configureReadReplica({ url: relayUrl.toString(), probe: healthy });
      expect((await report(fom, "revenue-by-code", D, D)).status).toBe(200);
      stalled = true;
      env.DATABASE_STATEMENT_TIMEOUT_MS = 100; // replica deadline ≈ 5.1 s
      const started = Date.now();
      // Both answer from the primary: the first after the deadline, the second
      // as soon as the slot is free (REPORT_HEAVY_CONCURRENCY 1), not 429.
      const [first, second] = await Promise.all([
        report(fom, "revenue-by-code", D, D),
        report(fom, "revenue-by-code", D, D),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      env.DATABASE_STATEMENT_TIMEOUT_MS = saved;
      await configureReadReplica(null);
      relay.close();
      for (const socket of sockets) socket.destroy();
    }
  }, 40_000);
});
