import { beforeAll, describe, expect, it } from "vitest";
import { GET as auditLogsRoute } from "@/app/api/v1/properties/[propertyId]/audit-logs/route";
import { POST as initializeRoute } from "@/app/api/v1/properties/[propertyId]/business-date/initialize/route";
import { GET as businessDateRoute } from "@/app/api/v1/properties/[propertyId]/business-date/route";
import { PATCH as patchConfigurationRoute } from "@/app/api/v1/properties/[propertyId]/configuration/route";
import { prisma } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { addDays, localDateInZone } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

let org: FixtureOrg;
let adminJar: CookieJar;
let readerJar: CookieJar;

const bdPath = (id: string) => `/api/v1/properties/${id}/business-date`;

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "LIVE", timezone: "Pacific/Auckland" },
      { key: "NEW", timezone: "America/Los_Angeles", live: false },
      { key: "LOCKED", timezone: "Asia/Karachi" },
    ],
  });
  adminJar = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
  const reader = await createUser(org, "reader", [
    { role: "READ_ONLY", property: "LIVE" },
    { role: "READ_ONLY", property: "NEW" },
  ]);
  readerJar = await loginAs(reader.email, TEST_PASSWORD);
});

describe("business date retrieval", () => {
  it("returns the business date with the property's own local date, time and time zone", async () => {
    const live = org.properties.LIVE!;
    const before = new Date();
    const r = await call(businessDateRoute, {
      path: bdPath(live.id),
      params: { propertyId: live.id },
      jar: readerJar,
    });
    expect(r.status).toBe(200);
    const view = r.body.data;
    expect(view.timezone).toBe("Pacific/Auckland");
    expect(view.status).toBe("OPEN");
    expect(view.businessDate).toBe(localDateInZone(before, "Pacific/Auckland"));
    // Local date is computed in the property zone, not the server's.
    expect([
      localDateInZone(before, "Pacific/Auckland"),
      localDateInZone(new Date(), "Pacific/Auckland"),
    ]).toContain(view.propertyLocalDate);
    expect(view.propertyLocalTime).toMatch(/^\d{2}:\d{2}$/);
    expect(view.sync).toEqual({ state: "IN_SYNC", lagDays: 0 });
  });

  it("reports NOT_INITIALIZED before go-live", async () => {
    const fresh = org.properties.NEW!;
    const r = await call(businessDateRoute, {
      path: bdPath(fresh.id),
      params: { propertyId: fresh.id },
      jar: readerJar,
    });
    expect(r.body.data).toMatchObject({
      status: "NOT_INITIALIZED",
      businessDate: null,
      sync: null,
    });
  });
});

describe("business date initialization (go-live)", () => {
  it("requires properties:manage", async () => {
    const fresh = org.properties.NEW!;
    const r = await call(initializeRoute, {
      method: "POST",
      path: `${bdPath(fresh.id)}/initialize`,
      params: { propertyId: fresh.id },
      body: { date: localDateInZone(new Date(), fresh.timezone), reason: "Go live" },
      jar: readerJar,
    });
    expect(r.status).toBe(403);
  });

  it("rejects a date that is not the property's local date (or the day before)", async () => {
    const fresh = org.properties.NEW!;
    const r = await call(initializeRoute, {
      method: "POST",
      path: `${bdPath(fresh.id)}/initialize`,
      params: { propertyId: fresh.id },
      body: { date: addDays(localDateInZone(new Date(), fresh.timezone), 3), reason: "Go live" },
      jar: adminJar,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("opens the first business date once, audited as HIGH", async () => {
    const fresh = org.properties.NEW!;
    const date = localDateInZone(new Date(), fresh.timezone);
    const request = {
      method: "POST",
      path: `${bdPath(fresh.id)}/initialize`,
      params: { propertyId: fresh.id },
      body: { date, reason: "Opening day" },
      jar: adminJar,
    };
    const first = await call(initializeRoute, request);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ businessDate: date, status: "OPEN" });

    const again = await call(initializeRoute, request);
    expect(again.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({
      where: { propertyId: fresh.id, action: "business_date.initialize" },
    });
    expect(audit).toMatchObject({ risk: "HIGH", reason: "Opening day" });
    expect(audit?.businessDate?.toISOString().slice(0, 10)).toBe(date);
  });

  it("forbids changing the time zone after go-live", async () => {
    const live = org.properties.LIVE!;
    const r = await call(patchConfigurationRoute, {
      method: "PATCH",
      path: `/api/v1/properties/${live.id}/configuration`,
      params: { propertyId: live.id },
      body: { timezone: "Asia/Tokyo", reason: "Wrong zone" },
      jar: adminJar,
    });
    expect(r.status).toBe(422);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: live.id } })).timezone).toBe(
      "Pacific/Auckland",
    );
  });
});

describe("business date lock for posting services", () => {
  it("returns the open date and refuses while night audit runs", async () => {
    const locked = org.properties.LOCKED!;
    const today = localDateInZone(new Date(), locked.timezone);
    await expect(runInTransaction((tx) => requireOpenBusinessDate(tx, locked.id))).resolves.toBe(
      today,
    );

    await prisma.businessDate.updateMany({
      where: { propertyId: locked.id, isCurrent: true },
      data: { status: "IN_AUDIT" },
    });
    await expect(
      runInTransaction((tx) => requireOpenBusinessDate(tx, locked.id)),
    ).rejects.toMatchObject({
      code: "BUSINESS_DATE_LOCKED",
    });
    const r = await call(businessDateRoute, {
      path: bdPath(locked.id),
      params: { propertyId: locked.id },
      jar: adminJar,
    });
    expect(r.body.data.status).toBe("IN_AUDIT");
  });
});

describe("audit trail", () => {
  it("lists a property's audit records newest first with cursor pagination", async () => {
    const live = org.properties.LIVE!;
    for (const minutes of [10, 20, 30]) {
      await call(patchConfigurationRoute, {
        method: "PATCH",
        path: `/api/v1/properties/${live.id}/configuration`,
        params: { propertyId: live.id },
        body: { roomHoldDefaultMinutes: minutes, reason: `Set hold to ${minutes}` },
        jar: adminJar,
      });
    }
    const path = `/api/v1/properties/${live.id}/audit-logs`;
    const page1 = await call(auditLogsRoute, {
      path: `${path}?limit=2&risk=HIGH`,
      params: { propertyId: live.id },
      jar: adminJar,
    });
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.data[0].reason).toBe("Set hold to 30");
    expect(page1.body.data[0].userDisplayName).toContain("Admin");
    expect(page1.body.meta.nextCursor).toEqual(expect.any(String));

    const page2 = await call(auditLogsRoute, {
      path: `${path}?limit=2&risk=HIGH&cursor=${page1.body.meta.nextCursor}`,
      params: { propertyId: live.id },
      jar: adminJar,
    });
    expect(page2.body.data[0].reason).toBe("Set hold to 10");
    const ids = [...page1.body.data, ...page2.body.data].map((row: { id: string }) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requires audit:read and rejects malformed cursors", async () => {
    const live = org.properties.LIVE!;
    const path = `/api/v1/properties/${live.id}/audit-logs`;
    expect(
      (await call(auditLogsRoute, { path, params: { propertyId: live.id }, jar: readerJar }))
        .status,
    ).toBe(403);
    const bad = await call(auditLogsRoute, {
      path: `${path}?cursor=garbage`,
      params: { propertyId: live.id },
      jar: adminJar,
    });
    expect(bad.status).toBe(400);
  });

  it("cannot be modified or deleted, even directly in the database", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org.organizationId },
    });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { reason: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
