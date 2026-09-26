import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as auditLogsRoute } from "@/app/api/v1/audit-logs/route";
import { GET as availabilityRoute } from "@/app/api/v1/availability/route";
import { GET as guestRoute } from "@/app/api/v1/guests/[guestId]/route";
import { GET as guestSearchRoute, POST as createGuestRoute } from "@/app/api/v1/guests/route";
import { GET as overviewRoute } from "@/app/api/v1/organization/overview/route";
import { GET as exportRoute } from "@/app/api/v1/organization/reports/performance/export/route";
import { GET as performanceRoute } from "@/app/api/v1/organization/reports/performance/route";
import { PATCH as configurationRoute } from "@/app/api/v1/properties/[propertyId]/configuration/route";
import { POST as chargesRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/charges/route";
import { POST as paymentsRoute } from "@/app/api/v1/properties/[propertyId]/folios/[folioId]/payments/route";
import { POST as voidRoute } from "@/app/api/v1/properties/[propertyId]/payments/[paymentId]/void/route";
import { POST as cancelRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/cancel/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { GET as folioAccountRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/folio/route";
import { PATCH as updateRoomRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/route";
import {
  GET as reservationsRoute,
  POST as createReservationRoute,
} from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as copySetupRoute } from "@/app/api/v1/properties/[propertyId]/setup/copy-from/[sourceId]/route";
import { GET as usersRoute } from "@/app/api/v1/users/route";
import { prisma } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { addDays } from "@/modules/business-date/business-date.policy";
import { recordAudit } from "@/modules/audit/audit.service";
import { recordEvent } from "@/modules/integrations/outbox.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, ORIGIN, call, loginAs } from "./support/http";

/**
 * Phase 9: multi-property operations. Organization with a PKR property (A),
 * an AED property (B) and two properties that are not live yet (C, D).
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let other: FixtureOrg;
let A: string;
let B: string;
let C: string;
let invA: Inventory;
let invB: Inventory;
let DA: string;
let DB: string;
let admin: CookieJar; // organization admin
let multi: CookieJar; // front office manager @ A and @ B
let single: CookieJar; // front desk agent @ A only
let cashier: CookieJar; // cashier @ A only
let auditorA: CookieJar; // auditor @ A only
let orgAuditor: CookieJar; // auditor at organization scope
let gmA: CookieJar; // general manager @ A (users:manage there, no properties:manage)
let outsider: CookieJar; // another organization
let guestId: string;

const P = (propertyId: string) => `/api/v1/properties/${propertyId}`;
const key = () => `k-${randomUUID()}`;

async function book(propertyId: string, jar: CookieJar, arrivalOffset = 0, roomId?: string) {
  const inv = propertyId === A ? invA : invB;
  const date = propertyId === A ? DA : DB;
  const r = await call(createReservationRoute, {
    method: "POST",
    path: `${P(propertyId)}/reservations`,
    params: { propertyId },
    body: {
      arrival: addDays(date, arrivalOffset),
      departure: addDays(date, arrivalOffset + 2),
      adults: 1,
      roomTypeId: inv.roomTypes.KNG!.id,
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
      ...(roomId ? { roomId } : {}),
    },
    jar,
  });
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  return r.body.data as {
    id: string;
    confirmationNumber: string;
    rooms: { id: string; version: number }[];
  };
}

const get = (route: Parameters<typeof call>[0], path: string, jar: CookieJar) =>
  call(route, { path, jar });

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai", currencyCode: "AED" },
      { key: "C", timezone: "Asia/Karachi", live: false },
      { key: "D", timezone: "Asia/Karachi", live: false },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  C = org.properties.C!.id;
  invA = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 6 }]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 4, oneAdult: "450" }]);
  DA = invA.businessDate;
  DB = invB.businessDate;
  guestId = (await createGuestRow(org, "Mira", "Multi")).id;

  const users = {
    multi: await createUser(org, "multi", [
      { role: "FRONT_OFFICE_MANAGER", property: "A" },
      { role: "FRONT_OFFICE_MANAGER", property: "B" },
    ]),
    single: await createUser(org, "single", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    cashier: await createUser(org, "cashier", [{ role: "CASHIER", property: "A" }]),
    auditorA: await createUser(org, "auditora", [{ role: "AUDITOR", property: "A" }]),
    orgAuditor: await createUser(org, "orgauditor", [{ role: "AUDITOR" }]),
    gmA: await createUser(org, "gma", [{ role: "GENERAL_MANAGER", property: "A" }]),
    outsider: await createUser(other, "gmx", [{ role: "GENERAL_MANAGER", property: "X" }]),
  };
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
  multi = await loginAs(users.multi.email, TEST_PASSWORD);
  single = await loginAs(users.single.email, TEST_PASSWORD);
  cashier = await loginAs(users.cashier.email, TEST_PASSWORD);
  auditorA = await loginAs(users.auditorA.email, TEST_PASSWORD);
  orgAuditor = await loginAs(users.orgAuditor.email, TEST_PASSWORD);
  gmA = await loginAs(users.gmA.email, TEST_PASSWORD);
  outsider = await loginAs(users.outsider.email, TEST_PASSWORD);
});

describe("A. property isolation of organization endpoints", () => {
  it("shows each user only the properties they can access", async () => {
    const ids = async (jar: CookieJar) =>
      (await get(overviewRoute, "/api/v1/organization/overview", jar)).body.data.properties.map(
        (p: { property: { id: string } }) => p.property.id,
      );
    expect((await ids(admin)).sort()).toEqual([A, B, C, org.properties.D!.id].sort());
    expect((await ids(multi)).sort()).toEqual([A, B].sort());
    expect(await ids(single)).toEqual([A]);
    expect(await ids(cashier)).toEqual([A]);
    expect(await ids(outsider)).not.toContain(A);
    const overview = (await get(overviewRoute, "/api/v1/organization/overview", admin)).body.data;
    const b = overview.properties.find((p: { property: { id: string } }) => p.property.id === B);
    expect(b).toMatchObject({ businessDate: DB, dateStatus: "OPEN" });
    expect(b.property.currencyCode).toBe("AED");
    const c = overview.properties.find((p: { property: { id: string } }) => p.property.id === C);
    expect(c).toMatchObject({ businessDate: null, dateStatus: "NOT_INITIALIZED", today: null });
  });

  it("refuses property ids outside the caller's scope instead of filtering them silently", async () => {
    const range = `from=${DA}&to=${DA}`;
    expect(
      (
        await get(
          performanceRoute,
          `/api/v1/organization/reports/performance?${range}&propertyIds=${B}`,
          single,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await get(
          availabilityRoute,
          `/api/v1/availability?arrival=${DA}&departure=${addDays(DA, 1)}&adults=1&propertyIds=${B}`,
          single,
        )
      ).status,
    ).toBe(403);
    expect((await get(auditLogsRoute, `/api/v1/audit-logs?scope=${B}`, auditorA)).status).toBe(403);
    // Another organization's property id is just as inaccessible.
    const x = other.properties.X!.id;
    expect(
      (
        await get(
          performanceRoute,
          `/api/v1/organization/reports/performance?${range}&propertyIds=${x}`,
          admin,
        )
      ).status,
    ).toBe(403);
  });
});

describe("B. organization-scope RBAC", () => {
  it("guards reports, availability and audit by permission", async () => {
    const range = `from=${DA}&to=${DA}`;
    expect(
      (await get(performanceRoute, `/api/v1/organization/reports/performance?${range}`, cashier))
        .status,
    ).toBe(403);
    // search:global is required for central availability (the cashier lacks it).
    expect(
      (
        await get(
          availabilityRoute,
          `/api/v1/availability?arrival=${DA}&departure=${addDays(DA, 1)}&adults=1`,
          cashier,
        )
      ).status,
    ).toBe(403);
    expect((await get(auditLogsRoute, "/api/v1/audit-logs", single)).status).toBe(403);
    expect(
      (await get(auditLogsRoute, "/api/v1/audit-logs?scope=organization", auditorA)).status,
    ).toBe(403);
  });

  it("lists user assignments only for scopes the caller may inspect", async () => {
    const list = await get(usersRoute, "/api/v1/users?page=1&pageSize=100", gmA);
    expect(list.status).toBe(200);
    const all = list.body.data.flatMap(
      (u: { assignments: { scope: string; property: { id: string } | null }[] }) => u.assignments,
    );
    expect(all.length).toBeGreaterThan(0);
    expect(
      all.every(
        (a: { scope: string; property: { id: string } | null }) =>
          a.scope === "PROPERTY" && a.property?.id === A,
      ),
    ).toBe(true);
    const multiUser = list.body.data.find((u: { email: string }) => u.email.startsWith("multi."));
    expect(multiUser.assignments).toHaveLength(1);
    // The organization admin sees every scope.
    const full = await get(usersRoute, "/api/v1/users?page=1&pageSize=100", admin);
    const multiFull = full.body.data.find((u: { email: string }) => u.email.startsWith("multi."));
    expect(multiFull.assignments).toHaveLength(2);
    expect(
      full.body.data.some((u: { assignments: { scope: string }[] }) =>
        u.assignments.some((a) => a.scope === "ORGANIZATION"),
      ),
    ).toBe(true);
    // Without users:read anywhere the list is refused.
    expect((await get(usersRoute, "/api/v1/users?page=1&pageSize=10", multi)).status).toBe(403);
  });
});

describe("C. confirmation numbers", () => {
  it("issues property-prefixed numbers: same sequence, unique full numbers", async () => {
    const a = await book(A, admin, 5);
    const b = await book(B, admin, 5);
    expect(a.confirmationNumber).toBe(`${org.properties.A!.code}-100000`);
    expect(b.confirmationNumber).toBe(`${org.properties.B!.code}-100000`);
    expect(a.confirmationNumber).not.toBe(b.confirmationNumber);
    const next = await book(A, admin, 8);
    expect(next.confirmationNumber).toBe(`${org.properties.A!.code}-100001`);
  });

  it("keeps the prefix unique in the organization and fixed after go-live", async () => {
    const patch = (propertyId: string, body: Record<string, unknown>) =>
      call(configurationRoute, {
        method: "PATCH",
        path: `${P(propertyId)}/configuration`,
        params: { propertyId },
        body: { reason: "Numbering", ...body },
        jar: admin,
      });
    const duplicate = await patch(C, { confirmationPrefix: org.properties.A!.code });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details.fields.confirmationPrefix).toBeDefined();
    const renamed = await patch(C, { confirmationPrefix: `Q${org.suffix.slice(0, 5)}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.confirmationPrefix).toBe(`Q${org.suffix.slice(0, 5)}`);
    expect((await patch(A, { confirmationPrefix: `Z${org.suffix.slice(0, 5)}` })).status).toBe(422);
    // The database refuses duplicates too.
    await expect(
      prisma.property.update({
        where: { id: C },
        data: { confirmationPrefix: org.properties.A!.code },
      }),
    ).rejects.toThrow();
    // Restore C for the setup tests.
    await prisma.property.update({
      where: { id: C },
      data: { confirmationPrefix: org.properties.C!.code },
    });
  });

  it("finds prefixed and legacy numbers, within the caller's properties only", async () => {
    const a = await book(A, admin, 12);
    const b = await book(B, admin, 12);
    const legacy = await book(A, admin, 20);
    // A number issued before Phase 9 (plain digits) stays readable.
    const legacyNumber = `9${randomUUID().replace(/\D/g, "").slice(0, 5).padEnd(5, "1")}`;
    await prisma.reservation.update({
      where: { id: legacy.id },
      data: { confirmationNumber: legacyNumber },
    });
    const search = (propertyId: string, q: string, jar: CookieJar) =>
      call(reservationsRoute, {
        path: `${P(propertyId)}/reservations?q=${encodeURIComponent(q)}`,
        params: { propertyId },
        jar,
      });
    const numbers = (r: Awaited<ReturnType<typeof search>>) =>
      r.body.data.map((x: { confirmationNumber: string }) => x.confirmationNumber);
    expect(numbers(await search(A, a.confirmationNumber, single))).toEqual([a.confirmationNumber]);
    expect(numbers(await search(A, legacyNumber, single))).toEqual([legacyNumber]);
    // B's number never surfaces in A's list, and B's list is closed to A-only staff.
    expect(numbers(await search(A, b.confirmationNumber, single))).toEqual([]);
    expect((await search(B, b.confirmationNumber, single)).status).toBe(403);
    // Guest search by confirmation respects reservations:read per property.
    const guests = async (q: string, jar: CookieJar) =>
      (
        await call(guestSearchRoute, { path: `/api/v1/guests?q=${encodeURIComponent(q)}`, jar })
      ).body.data.map((g: { id: string }) => g.id);
    expect(await guests(a.confirmationNumber, single)).toContain(guestId);
    expect(await guests(legacyNumber, single)).toContain(guestId);
    expect(await guests(b.confirmationNumber, single)).not.toContain(guestId);
    expect(await guests(b.confirmationNumber, multi)).toContain(guestId);
  });
});

describe("D. property setup copy", () => {
  const copy = (target: string, source: string, jar: CookieJar, reason = "Pre-opening setup") =>
    call(copySetupRoute, {
      method: "POST",
      path: `${P(target)}/setup/copy-from/${source}`,
      params: { propertyId: target, sourceId: source },
      body: { reason },
      jar,
    });

  it("copies reference data once, never rooms, rates or history, and audits it", async () => {
    expect((await copy(C, A, gmA)).status).toBe(403);
    const first = await copy(C, A, admin);
    expect(first.status).toBe(200);
    expect(first.body.data.copied).toBeGreaterThan(0);
    const section = (key: string) =>
      first.body.data.sections.find((s: { key: string }) => s.key === key);
    expect(section("transactionCodes").copied).toBe(
      await prisma.transactionCode.count({ where: { propertyId: A, status: "ACTIVE" } }),
    );
    expect(section("paymentMethods").copied).toBeGreaterThan(0);
    expect(section("reservationTypes").copied).toBeGreaterThan(0);
    const counts = async (propertyId: string) => ({
      codes: await prisma.transactionCode.count({ where: { propertyId } }),
      reasons: await prisma.reasonCode.count({ where: { propertyId } }),
      payments: await prisma.paymentMethod.count({ where: { propertyId } }),
      blockStatuses: await prisma.blockStatus.count({ where: { propertyId } }),
      cancellationPolicies: await prisma.cancellationPolicy.count({ where: { propertyId } }),
    });
    expect(await counts(C)).toEqual(await counts(A));
    // Physical and commercial setup is never copied.
    expect(await prisma.roomType.count({ where: { propertyId: C } })).toBe(0);
    expect(await prisma.room.count({ where: { propertyId: C } })).toBe(0);
    expect(await prisma.ratePlan.count({ where: { propertyId: C } })).toBe(0);
    expect(await prisma.rateSeason.count({ where: { propertyId: C } })).toBe(0);
    expect(await prisma.reservation.count({ where: { propertyId: C } })).toBe(0);
    expect(await prisma.businessDate.count({ where: { propertyId: C } })).toBe(0);
    // Night audit codes point at the copied codes.
    const config = await prisma.propertyConfiguration.findUniqueOrThrow({
      where: { propertyId: C },
      include: { noShowTransactionCode: true },
    });
    expect(config.noShowTransactionCode?.propertyId).toBe(C);

    // Idempotent: a retry copies nothing and duplicates nothing.
    const again = await copy(C, A, admin);
    expect(again.status).toBe(200);
    expect(again.body.data.copied).toBe(0);
    expect(await counts(C)).toEqual(await counts(A));

    const audit = await prisma.auditLog.findMany({
      where: { resourceId: C, action: "property.setup_copy" },
    });
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.risk === "HIGH" && row.propertyId === C)).toBe(true);
  });

  it("is blocked once the target is live, and converts no currency", async () => {
    const live = await copy(A, B, admin);
    expect(live.status).toBe(422);
    expect(live.body.error.details.reason).toBe("PROPERTY_LIVE");
    expect((await copy(C, C, admin)).status).toBe(400);

    // B (AED) → D (PKR): prices in AED are not carried over.
    const priced = await prisma.transactionCode.findFirstOrThrow({
      where: { propertyId: B, code: "2000" },
    });
    await prisma.transactionCode.update({
      where: { id: priced.id },
      data: { defaultPrice: "45.0000" },
    });
    const D = org.properties.D!.id;
    const r = await copy(D, B, admin);
    expect(r.status).toBe(200);
    const codes = r.body.data.sections.find((s: { key: string }) => s.key === "transactionCodes");
    expect(codes.needsReview).toContain("2000");
    const copied = await prisma.transactionCode.findFirstOrThrow({
      where: { propertyId: D, code: "2000" },
    });
    expect(copied.defaultPrice).toBeNull();
  });
});

describe("E. organization reports by currency", () => {
  it("reports each property in its own currency and never sums across currencies", async () => {
    const r = await get(
      performanceRoute,
      `/api/v1/organization/reports/performance?from=${addDays(DA, -1)}&to=${DA}`,
      admin,
    );
    expect(r.status).toBe(200);
    const data = r.body.data;
    const byId = (id: string) =>
      data.properties.find((p: { property: { id: string } }) => p.property.id === id);
    expect(byId(A)).toMatchObject({ currencyCode: "PKR", businessDate: DA, liveIncluded: true });
    expect(byId(B)).toMatchObject({ currencyCode: "AED", businessDate: DB });
    expect(data.currencies.map((c: { currencyCode: string }) => c.currencyCode)).toEqual([
      "AED",
      "PKR",
    ]);
    const aed = data.currencies.find((c: { currencyCode: string }) => c.currencyCode === "AED");
    const pkr = data.currencies.find((c: { currencyCode: string }) => c.currencyCode === "PKR");
    // Each currency total equals its only property: nothing crosses currencies.
    expect(aed.propertyCount).toBe(1);
    expect(pkr.propertyCount).toBe(1);
    expect(aed.roomRevenue).toBe(byId(B).roomRevenue);
    expect(pkr.roomRevenue).toBe(byId(A).roomRevenue);
    expect(aed.payments).toBe(byId(B).payments);
    // Room counts may be totalled across properties.
    expect(data.overall.roomsAvailable).toBe(byId(A).roomsAvailable + byId(B).roomsAvailable);
    expect(data.excluded.map((e: { property: { id: string } }) => e.property.id)).toContain(C);
  });

  it("filters properties and money by permission", async () => {
    const path = `/api/v1/organization/reports/performance?from=${DA}&to=${DA}`;
    const agentView = (await get(performanceRoute, path, single)).body.data;
    expect(agentView.properties.map((p: { property: { id: string } }) => p.property.id)).toEqual([
      A,
    ]);
    // The front desk agent has reports:read but not reports:financial.
    expect(agentView.properties[0]).toMatchObject({ financial: false, roomRevenue: null });
    expect(agentView.currencies[0]).toMatchObject({ financial: false, payments: null });
    // Both business dates are in range (the properties may be a calendar day apart).
    const exportPath = `/api/v1/organization/reports/performance/export?from=${addDays(DA, -1)}&to=${DA > DB ? DA : DB}`;
    const download = (jar: CookieJar) =>
      exportRoute(
        new NextRequest(new URL(exportPath, ORIGIN), {
          headers: { cookie: jar.header(), "x-forwarded-for": "198.51.100.77" },
        }),
        { params: Promise.resolve({}) },
      );
    const csv = await download(admin);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("Total PKR");
    expect(text).toContain("Total AED");
    expect((await download(single)).status).toBe(403);
  });
});

describe("F. central availability", () => {
  it("searches accessible properties with their own rules and currencies", async () => {
    const arrival = addDays(DA > DB ? DA : DB, 30);
    // A closed house on B for the first night: B's rule, not A's.
    await prisma.restriction.create({
      data: {
        propertyId: B,
        stayDate: new Date(`${arrival}T00:00:00.000Z`),
        type: "CLOSED",
        createdById: org.adminId,
      },
    });
    const path = `/api/v1/availability?arrival=${arrival}&departure=${addDays(arrival, 2)}&adults=1`;
    const r = await get(availabilityRoute, path, admin);
    expect(r.status).toBe(200);
    const byId = (id: string) =>
      r.body.data.properties.find((p: { property: { id: string } }) => p.property.id === id);
    expect(byId(A).property.currencyCode).toBe("PKR");
    expect(byId(B).property.currencyCode).toBe("AED");
    expect(byId(C)).toMatchObject({ status: "NOT_LIVE", roomTypes: [] });
    expect(byId(B).roomTypes[0].status).toBe("CLOSED");
    expect(byId(B).status).toBe("UNAVAILABLE");
    expect(byId(A).status).toBe("AVAILABLE");
    expect(byId(A).roomTypes[0].lowestTotal).not.toBeNull();
    expect(byId(A).canBook).toBe(true);
    // A single-property user sees only that property.
    const mine = await get(availabilityRoute, path, single);
    expect(
      mine.body.data.properties.map((p: { property: { id: string } }) => p.property.id),
    ).toEqual([A]);
  });
});

describe("G. audit scope", () => {
  it("limits the organization trail to the caller's audit scope", async () => {
    const rows = async (jar: CookieJar, query = "") =>
      (await get(auditLogsRoute, `/api/v1/audit-logs?limit=200${query}`, jar)).body.data as {
        property: { id: string } | null;
        action: string;
      }[];
    const propertyOnly = await rows(auditorA);
    expect(propertyOnly.length).toBeGreaterThan(0);
    expect(propertyOnly.every((row) => row.property?.id === A)).toBe(true);
    const orgRows = await rows(orgAuditor, "&scope=organization");
    expect(orgRows.length).toBeGreaterThan(0);
    expect(orgRows.every((row) => row.property === null)).toBe(true);
    const bOnly = await rows(multi, `&scope=${B}`);
    expect(bOnly.every((row) => row.property?.id === B)).toBe(true);
    // Paginates with a cursor.
    const page = await get(auditLogsRoute, "/api/v1/audit-logs?limit=2", orgAuditor);
    expect(page.body.meta.nextCursor).toBeTruthy();
    const next = await get(
      auditLogsRoute,
      `/api/v1/audit-logs?limit=2&cursor=${encodeURIComponent(page.body.meta.nextCursor)}`,
      orgAuditor,
    );
    expect(next.body.data[0].id).not.toBe(page.body.data[0].id);
  });

  it("hides resource history from properties and scopes the caller cannot audit", async () => {
    const created = await call(createGuestRoute, {
      method: "POST",
      path: "/api/v1/guests",
      body: { firstName: "Hera", lastName: `History${org.suffix}` },
      jar: admin,
    });
    const id = created.body.data.id as string;
    // A history row written at B about this guest.
    await runInTransaction((tx) =>
      recordAudit(
        tx,
        { organizationId: org.organizationId, propertyId: B, userId: org.adminId },
        { action: "guest.test_marker", resourceType: "Guest", resourceId: id },
      ),
    );
    const history = async (jar: CookieJar) =>
      (
        (await call(guestRoute, { path: `/api/v1/guests/${id}`, params: { guestId: id }, jar }))
          .body.data.history as { action: string }[]
      ).map((h) => h.action);
    // Property auditor at A: neither organization rows nor B's rows.
    expect(await history(auditorA)).toEqual([]);
    // Organization auditor: organization rows and every property's rows.
    expect((await history(orgAuditor)).sort()).toEqual(["guest.create", "guest.test_marker"]);
    // Audit rights at A and B: B's row, but not the organization-level creation.
    expect(await history(multi)).toEqual(["guest.test_marker"]);
  });
});

describe("H. transactional outbox", () => {
  const events = (aggregateId: string) =>
    prisma.outboxEvent.findMany({ where: { aggregateId }, orderBy: { occurredAt: "asc" } });

  it("records reservation, stay and payment events with ids only", async () => {
    const booked = await book(A, admin, 0, invA.roomTypes.KNG!.roomIds[1]);
    const rr = booked.rooms[0]!;
    const [created] = await events(booked.id);
    expect(created).toMatchObject({
      eventType: "reservation.created",
      aggregateType: "Reservation",
      propertyId: A,
      status: "PENDING",
    });
    expect(created!.payload).toEqual({
      version: 1,
      organizationId: org.organizationId,
      propertyId: A,
      reservationId: booked.id,
      reservationRoomIds: [rr.id],
    });

    const modified = await call(updateRoomRoute, {
      method: "PATCH",
      path: `${P(A)}/reservation-rooms/${rr.id}`,
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: rr.version, departure: addDays(DA, 3) },
      jar: admin,
    });
    expect(modified.status).toBe(200);
    const modifiedEvent = (await events(booked.id)).find(
      (e) => e.eventType === "reservation.modified",
    );
    expect((modifiedEvent!.payload as { changedFields: string[] }).changedFields).toContain(
      "departure",
    );

    const checkedIn = await call(checkInRoute, {
      method: "POST",
      path: `${P(A)}/reservation-rooms/${rr.id}/check-in`,
      params: { propertyId: A, reservationRoomId: rr.id },
      body: { version: modified.body.data.rooms[0].version },
      jar: admin,
    });
    expect(checkedIn.status).toBe(201);
    const stayId = checkedIn.body.data.id as string;
    expect((await events(stayId)).map((e) => e.eventType)).toEqual(["stay.checked_in"]);

    const account = await call(folioAccountRoute, {
      path: `${P(A)}/reservation-rooms/${rr.id}/folio`,
      params: { propertyId: A, reservationRoomId: rr.id },
      jar: admin,
    });
    const w = account.body.data.windows[0];
    const charged = await call(chargesRoute, {
      method: "POST",
      path: `${P(A)}/folios/${w.id}/charges`,
      params: { propertyId: A, folioId: w.id },
      body: { transactionCodeId: invA.chargeCodes["2000"], quantity: 1, unitAmount: "500.00" },
      headers: { "idempotency-key": key() },
      jar: admin,
    });
    expect(charged.status).toBe(201);
    const paid = await call(paymentsRoute, {
      method: "POST",
      path: `${P(A)}/folios/${w.id}/payments`,
      params: { propertyId: A, folioId: w.id },
      body: {
        methodId: invA.paymentMethods.CASH,
        amount: "200.00",
        version: charged.body.data.version,
      },
      headers: { "idempotency-key": key() },
      jar: admin,
    });
    expect(paid.status).toBe(201);
    const paymentId = paid.body.data.paymentId as string;
    const voided = await call(voidRoute, {
      method: "POST",
      path: `${P(A)}/payments/${paymentId}/void`,
      params: { propertyId: A, paymentId },
      body: { reason: "Wrong folio", reasonCodeId: invA.reasonCodes["VOID:ERR"] },
      headers: { "idempotency-key": key() },
      jar: admin,
    });
    expect(voided.status).toBe(201);
    const paymentEvents = await events(paymentId);
    expect(paymentEvents.map((e) => e.eventType)).toEqual(["payment.posted", "payment.voided"]);
    expect(paymentEvents[0]!.payload).toMatchObject({ paymentId, folioId: w.id });
    // No amounts or guest data in any payload.
    for (const e of paymentEvents) {
      expect(JSON.stringify(e.payload)).not.toMatch(/amount|200|Mira|guest/i);
    }
  });

  it("records a cancellation, and nothing for a command that fails", async () => {
    const booked = await book(A, admin, 40);
    const rr = booked.rooms[0]!;
    const cancelled = await call(cancelRoute, {
      method: "POST",
      path: `${P(A)}/reservation-rooms/${rr.id}/cancel`,
      params: { propertyId: A, reservationRoomId: rr.id },
      body: {
        version: rr.version,
        reasonCodeId: invA.reasonCodes["CANCELLATION:GUEST"],
        reason: "Guest cancelled",
      },
      jar: admin,
    });
    expect(cancelled.status).toBe(200);
    expect((await events(booked.id)).map((e) => e.eventType)).toEqual([
      "reservation.created",
      "reservation.cancelled",
    ]);

    const before = await prisma.outboxEvent.count({ where: { propertyId: A } });
    const refused = await call(createReservationRoute, {
      method: "POST",
      path: `${P(A)}/reservations`,
      params: { propertyId: A },
      body: {
        arrival: addDays(DA, 41),
        departure: addDays(DA, 42),
        adults: 9,
        roomTypeId: invA.roomTypes.KNG!.id,
        ratePlanId: invA.ratePlans.BAR!,
        reservationTypeId: invA.reservationTypes.GTD!,
        guestId,
      },
      jar: admin,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.outboxEvent.count({ where: { propertyId: A } })).toBe(before);
  });

  it("writes the event only when the transaction commits", async () => {
    const committedId = randomUUID();
    await runInTransaction((tx) =>
      recordEvent(
        tx,
        { organizationId: org.organizationId, propertyId: A },
        "reservation.cancelled",
        {
          reservationId: committedId,
          reservationRoomId: randomUUID(),
        },
      ),
    );
    expect(await events(committedId)).toHaveLength(1);

    const rolledBackId = randomUUID();
    await expect(
      runInTransaction(async (tx) => {
        await recordEvent(
          tx,
          { organizationId: org.organizationId, propertyId: A },
          "reservation.cancelled",
          { reservationId: rolledBackId, reservationRoomId: randomUUID() },
        );
        throw new Error("business rule failed after the event was written");
      }),
    ).rejects.toThrow();
    expect(await events(rolledBackId)).toHaveLength(0);
  });
});
