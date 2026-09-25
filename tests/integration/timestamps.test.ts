import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createGuestRoute } from "@/app/api/v1/guests/route";
import { prisma } from "@/lib/db/prisma";
import {
  fromDateOnly,
  localDateInZone,
  localMidnightUtc,
  toDateOnly,
} from "@/modules/business-date/business-date.policy";
import { runIdempotent } from "@/modules/idempotency/idempotency.service";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

/**
 * Shared infrastructure (ARCHITECTURE D29): application sessions run in UTC,
 * so an instant written by the application is the instant PostgreSQL's own
 * now() sees, whatever the server's default zone (Asia/Karachi here).
 * Property-local business dates keep using the property's time zone.
 */

let org: FixtureOrg;
let userId: string;
let agent: CookieJar;

const secondsFromNow = async (sql: Promise<{ delta: number }[]>) => Math.abs((await sql)[0]!.delta);

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  const user = await createUser(org, "tz", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
  userId = user.id;
  agent = await loginAs(user.email, TEST_PASSWORD);
});

describe("database session time zone", () => {
  it("runs every application session in UTC", async () => {
    const [row] = await prisma.$queryRaw<
      { tz: string }[]
    >`SELECT current_setting('TimeZone') AS tz`;
    expect(row!.tz).toBe("UTC");
    // Also inside interactive transactions (a separate pooled connection).
    const inTx = await prisma.$transaction(
      (tx) => tx.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`,
    );
    expect(inTx[0]!.tz).toBe("UTC");
  });

  it("stores a JavaScript Date parameter as the same instant", async () => {
    const instant = new Date("2026-03-14T09:26:53.589Z");
    const [row] = await prisma.$queryRaw<{ text: string; epoch: number }[]>`
      SELECT ${instant}::timestamptz::text AS text,
             (extract(epoch FROM ${instant}::timestamptz) * 1000)::float8 AS epoch`;
    expect(row!.epoch).toBe(instant.getTime());
    expect(row!.text).toBe("2026-03-14 09:26:53.589+00");
  });
});

describe("audit timestamps", () => {
  it("record the real instant, equal to the database clock", async () => {
    const created = await call(createGuestRoute, {
      method: "POST",
      path: "/api/v1/guests",
      body: { firstName: "Tess", lastName: `Timestamp${randomUUID().slice(0, 4)}` },
      jar: agent,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    // Compared inside PostgreSQL against its own now(): a zone shift would be ±5 h.
    const auditDelta = await secondsFromNow(
      prisma.$queryRaw<{ delta: number }[]>`
        SELECT extract(epoch FROM now() - created_at)::float8 AS delta
        FROM audit_logs WHERE resource_id = ${id} AND action = 'guest.create'`,
    );
    expect(auditDelta).toBeLessThan(60);
    // The profile row (Prisma-filled @default(now())) agrees as well.
    const guestDelta = await secondsFromNow(
      prisma.$queryRaw<{ delta: number }[]>`
        SELECT extract(epoch FROM now() - created_at)::float8 AS delta FROM guests WHERE id = ${id}::uuid`,
    );
    expect(guestDelta).toBeLessThan(60);
    // And reading it back through Prisma gives the same instant as the JS clock.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: id, action: "guest.create" },
      select: { createdAt: true },
    });
    expect(Math.abs(audit.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("idempotency keys", () => {
  const request = () => ({
    key: `tz-${randomUUID()}`,
    route: "POST /timestamps-test",
    // request_hash is CHAR(64): a real SHA-256 hex digest.
    requestHash: "a".repeat(64),
  });

  it("expire after the full 24 hours, not 5 hours early", async () => {
    const req = request();
    await prisma.$transaction((tx) => runIdempotent(tx, userId, req, async () => ({ ok: 1 })));
    const [row] = await prisma.$queryRaw<{ hours: number; created: number }[]>`
      SELECT extract(epoch FROM expires_at - now())::float8 / 3600 AS hours,
             abs(extract(epoch FROM now() - created_at))::float8 AS created
      FROM idempotency_keys WHERE user_id = ${userId}::uuid AND key = ${req.key}`;
    expect(row!.hours).toBeGreaterThan(23.9);
    expect(row!.hours).toBeLessThanOrEqual(24);
    // The server-written created_at and the application-written expires_at share one clock.
    expect(row!.created).toBeLessThan(60);
  });

  it("still replays a key 20 hours old (the old shift expired it after 19)", async () => {
    const req = request();
    let runs = 0;
    const work = async () => ({ run: ++runs });
    await prisma.$transaction((tx) => runIdempotent(tx, userId, req, work));
    // Age the key by 20 hours in the database's own terms.
    await prisma.$executeRaw`
      UPDATE idempotency_keys
         SET created_at = created_at - interval '20 hours', expires_at = expires_at - interval '20 hours'
       WHERE user_id = ${userId}::uuid AND key = ${req.key}`;
    const replay = await prisma.$transaction((tx) => runIdempotent(tx, userId, req, work));
    expect(replay).toEqual({ result: { run: 1 }, replayed: true });
    expect(runs).toBe(1);
    // Past 24 hours the key is free again.
    await prisma.$executeRaw`
      UPDATE idempotency_keys SET expires_at = now() - interval '1 minute'
       WHERE user_id = ${userId}::uuid AND key = ${req.key}`;
    const fresh = await prisma.$transaction((tx) => runIdempotent(tx, userId, req, work));
    expect(fresh).toEqual({ result: { run: 2 }, replayed: false });
  });
});

describe("Asia/Karachi business dates", () => {
  it("keep property-local calendar days regardless of the UTC session", async () => {
    // 20:30 UTC is 01:30 the next day in Karachi (UTC+5).
    expect(localDateInZone(new Date("2026-09-25T20:30:00Z"), "Asia/Karachi")).toBe("2026-09-26");
    expect(localDateInZone(new Date("2026-09-25T18:59:59Z"), "Asia/Karachi")).toBe("2026-09-25");
    expect(localMidnightUtc("2026-09-26", "Asia/Karachi").toISOString()).toBe(
      "2026-09-25T19:00:00.000Z",
    );
  });

  it("store and read DATE columns (business and stay dates) unchanged", async () => {
    const property = await prisma.property.findUniqueOrThrow({
      where: { id: org.properties.A!.id },
      select: { id: true },
    });
    const current = await prisma.businessDate.findFirstOrThrow({
      where: { propertyId: property.id, isCurrent: true },
      select: { date: true },
    });
    const text = toDateOnly(current.date);
    const [row] = await prisma.$queryRaw<{ text: string }[]>`
      SELECT "date"::text AS text FROM business_dates
      WHERE property_id = ${property.id}::uuid AND is_current`;
    expect(row!.text).toBe(text);
    const [roundTrip] = await prisma.$queryRaw<{ text: string }[]>`
      SELECT ${fromDateOnly("2026-12-31")}::date::text AS text`;
    expect(roundTrip!.text).toBe("2026-12-31");
  });

  it("find rows by a Karachi calendar day from UTC-stored instants", async () => {
    const created = await call(createGuestRoute, {
      method: "POST",
      path: "/api/v1/guests",
      body: { firstName: "Kara", lastName: `Chi${randomUUID().slice(0, 4)}` },
      jar: agent,
    });
    const today = localDateInZone(new Date(), "Asia/Karachi");
    const from = localMidnightUtc(today, "Asia/Karachi");
    const to = localMidnightUtc(
      toDateOnly(new Date(fromDateOnly(today).getTime() + 86_400_000)),
      "Asia/Karachi",
    );
    const found = await prisma.guest.count({
      where: { id: created.body.data.id, createdAt: { gte: from, lt: to } },
    });
    expect(found).toBe(1);
  });
});

describe("timestamps written before the UTC fix", () => {
  it("are converted by the migration's rule to the instants they represent", async () => {
    // The old write path: the adapter sent the UTC wall-clock text without an
    // offset and a session in the server zone (Asia/Karachi) stored it.
    // (Parameters would be shifted by that session too, so the check uses literals.)
    const [row] = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TimeZone = 'Asia/Karachi'`);
      return tx.$queryRaw<{ legacy: string; corrected: string; offBy: number }[]>`
        WITH legacy AS (SELECT '2026-09-25 13:36:37.214'::timestamptz AS stored)
        SELECT (stored AT TIME ZONE 'UTC')::text AS legacy,
               (serene_legacy_session_timestamp(stored, 'Asia/Karachi') AT TIME ZONE 'UTC')::text AS corrected,
               extract(epoch FROM '2026-09-25 13:36:37.214+00'::timestamptz - stored)::float8 / 3600 AS "offBy"
        FROM legacy`;
    });
    expect(row!.legacy).toBe("2026-09-25 08:36:37.214"); // five hours early
    expect(row!.offBy).toBe(5);
    expect(row!.corrected).toBe("2026-09-25 13:36:37.214"); // the real instant
    // Exact across a DST change as well (Europe/London, summer and winter).
    const [dst] = await prisma.$queryRaw<{ summer: string; winter: string }[]>`
      SELECT (serene_legacy_session_timestamp('2026-07-01 11:00:00+00'::timestamptz, 'Europe/London') AT TIME ZONE 'UTC')::text AS summer,
             (serene_legacy_session_timestamp('2026-12-01 12:00:00+00'::timestamptz, 'Europe/London') AT TIME ZONE 'UTC')::text AS winter`;
    // Stored 11:00Z in summer means the app wrote wall-clock 12:00 (BST +1): the meant instant is 12:00Z.
    expect(dst!.summer).toBe("2026-07-01 12:00:00");
    // In winter London is UTC+0: nothing to correct.
    expect(dst!.winter).toBe("2026-12-01 12:00:00");
  });

  it("are read back through Prisma as the corrected instant", async () => {
    const guest = await prisma.guest.create({
      data: {
        organizationId: org.organizationId,
        profileNumber: `TZ${randomUUID().slice(0, 6).toUpperCase()}`,
        firstName: "Legacy",
        lastName: "Row",
        searchName: "row legacy",
      },
      select: { id: true },
    });
    const meant = new Date("2026-09-25T13:36:37.214Z");
    // Simulate the pre-fix stored value, then apply the migration's correction.
    await prisma.$executeRaw`
      UPDATE guests SET created_at = ${meant}::timestamptz - interval '5 hours' WHERE id = ${guest.id}::uuid`;
    await prisma.$executeRaw`
      UPDATE guests SET created_at = serene_legacy_session_timestamp(created_at, 'Asia/Karachi')
      WHERE id = ${guest.id}::uuid`;
    const read = await prisma.guest.findUniqueOrThrow({
      where: { id: guest.id },
      select: { createdAt: true },
    });
    expect(read.createdAt.toISOString()).toBe(meant.toISOString());
  });
});
