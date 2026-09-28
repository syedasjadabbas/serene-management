import { beforeAll, describe, expect, it } from "vitest";
import { GET as overviewRoute } from "@/app/api/v1/organization/overview/route";
import { GET as readinessRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/readiness/route";
import { GET as exportRoute } from "@/app/api/v1/properties/[propertyId]/reports/[reportKey]/export/route";
import { GET as reportRoute } from "@/app/api/v1/properties/[propertyId]/reports/[reportKey]/route";
import { GET as boardRoute } from "@/app/api/v1/properties/[propertyId]/rooms/board/route";
import { GET as pickerRoute } from "@/app/api/v1/properties/[propertyId]/rooms/picker/route";
import { prisma } from "@/lib/db/prisma";
import { addDays } from "@/modules/business-date/business-date.policy";
import {
  MAX_REPORT_DAYS,
  REPORT_PAGE_SIZE,
  REPORT_ROW_LIMIT,
} from "@/modules/reports/reports.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";
import { countStatements } from "./support/statements";

/**
 * Scale behaviour (Phase 10, Part C): report row limits, paging and CSV
 * streaming (H10), the room board without silent truncation (M11), the
 * organization overview's statement budget (M9) and night-audit readiness
 * (B4). Assertions are on counts and statements, never wall-clock time.
 */

let org: FixtureOrg;
let A: string;
let B: string;
let D: string;
let admin: CookieJar;
let roomIds: string[];
let taskTypeId: string;

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai", currencyCode: "AED" },
      { key: "C", timezone: "Asia/Karachi", live: false },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  const inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 30 }]);
  await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 4 }]);
  D = inv.businessDate;
  roomIds = inv.roomTypes.KNG!.roomIds;
  taskTypeId = inv.taskTypes.DEP!;
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
}, 180_000);

/** Bulk housekeeping history (cancelled tasks: no live-task uniqueness) for the report. */
async function seedTasks(count: number, attendantId: string | null = null) {
  await prisma.$executeRaw`
    INSERT INTO "housekeeping_tasks" ("id", "property_id", "room_id", "task_type_id",
      "business_date", "status", "attendant_id", "updated_at")
    SELECT gen_random_uuid(), ${A}::uuid,
           (${roomIds}::uuid[])[1 + (n % ${roomIds.length})],
           ${taskTypeId}::uuid,
           ${D}::date - (n % 300), 'CANCELLED', ${attendantId}::uuid, now()
    FROM generate_series(0, ${count - 1}) AS n`;
}

const report = (key: string, query: string, route = reportRoute) =>
  call(route, {
    path: `/api/v1/properties/${A}/reports/${key}${route === exportRoute ? "/export" : ""}?${query}`,
    params: { propertyId: A, reportKey: key },
    jar: admin,
  });

describe("reports at scale (H10)", () => {
  const range = () => `from=${addDays(D, -299)}&to=${D}`;

  it("pages large JSON reports and streams the CSV with every row", async () => {
    const attendant = await prisma.housekeepingAttendant.create({
      data: { propertyId: A, code: "QT", name: 'Smith, "Jo"' },
    });
    await seedTasks(1_200, attendant.id);
    const first = await report("housekeeping", range());
    expect(first.status).toBe(200);
    expect(first.body.data.page).toEqual({ offset: 0, limit: REPORT_PAGE_SIZE, totalRows: 1_200 });
    expect(first.body.data.rows).toHaveLength(REPORT_PAGE_SIZE);
    const last = await report("housekeeping", `${range()}&offset=1000`);
    expect(last.body.data.rows).toHaveLength(200);
    expect(last.body.data.page.totalRows).toBe(1_200);
    expect(last.body.data.rows[0]).toEqual(
      (await report("housekeeping", `${range()}&offset=1000&limit=1`)).body.data.rows[0],
    );
    expect((await report("housekeeping", `${range()}&limit=1001`)).status).toBe(400);

    // CSV: every row, header order = column order, RFC 4180 quoting, streamed.
    const csv = await report("housekeeping", range(), exportRoute);
    expect(csv.status).toBe(200);
    expect(csv.response.headers.get("content-type")).toContain("text/csv");
    const text = csv.body as string;
    const lines = text.split("\r\n").filter((line) => line.length > 0);
    const columns = first.body.data.columns as { label: string }[];
    expect(lines[0]!.replace(/^﻿/, "")).toBe(columns.map((c) => c.label).join(","));
    expect(lines.length - 1).toBe(1_200 + (first.body.data.totals ? 1 : 0));
    expect(text).toContain('"Smith, ""Jo"""');
  });

  it("refuses a report above the row limit instead of truncating it", async () => {
    await seedTasks(REPORT_ROW_LIMIT + 1 - 1_200);
    for (const route of [reportRoute, exportRoute]) {
      const r = await report("housekeeping", range(), route);
      expect(r.status).toBe(422);
      expect(r.body.error.details).toMatchObject({
        reason: "REPORT_TOO_LARGE",
        limit: REPORT_ROW_LIMIT,
      });
    }
    // A narrower range of the same data is fine.
    const narrow = await report("housekeeping", `from=${D}&to=${D}`);
    expect(narrow.status).toBe(200);
  });

  it("keeps the date range bounded", async () => {
    const tooLong = await report("arrivals", `from=${addDays(D, -MAX_REPORT_DAYS)}&to=${D}`);
    expect(tooLong.status).toBe(400);
    const longest = await report("arrivals", `from=${addDays(D, 1 - MAX_REPORT_DAYS)}&to=${D}`);
    expect(longest.status).toBe(200);
  });
});

describe("room board at scale (M11)", () => {
  const board = (query: string) =>
    call(boardRoute, {
      path: `/api/v1/properties/${A}/rooms/board?${query}`,
      params: { propertyId: A },
      jar: admin,
    });

  it("counts every room and pages instead of dropping rooms", async () => {
    const whole = await board("filter=all");
    expect(whole.body.data.counts.total).toBe(30);
    expect(whole.body.data.page).toEqual({ offset: 0, limit: 1_000, total: 30 });
    expect(whole.body.data.items).toHaveLength(30);
    const pageOne = await board("filter=all&limit=12");
    const pageThree = await board("filter=all&limit=12&offset=24");
    expect(pageOne.body.data.items).toHaveLength(12);
    expect(pageThree.body.data.items).toHaveLength(6);
    expect(pageThree.body.data.counts.total).toBe(30);
    const seen = new Set<string>();
    for (let offset = 0; offset < 30; offset += 12) {
      const page = await board(`filter=all&limit=12&offset=${offset}`);
      for (const room of page.body.data.items as { id: string }[]) seen.add(room.id);
    }
    expect(seen.size).toBe(30);
    expect((await board("filter=all&limit=5000")).status).toBe(400);
  });

  it("offers a light room picker with every active room", async () => {
    const r = await call(pickerRoute, {
      path: `/api/v1/properties/${A}/rooms/picker`,
      params: { propertyId: A },
      jar: admin,
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(30);
    expect(r.body.data[0]).toEqual({
      id: expect.any(String),
      number: expect.any(String),
      roomTypeCode: "KNG",
    });
  });
});

describe("organization overview (M9)", () => {
  it("reads business dates once and only the overview figures per property", async () => {
    const get = () => call(overviewRoute, { path: "/api/v1/organization/overview", jar: admin });
    await get(); // warm-up
    const { result, statements, texts } = await countStatements(get);
    expect(result.status).toBe(200);
    const properties = result.body.data.properties as {
      property: { id: string; currencyCode: string };
      today: unknown;
      businessDate: string | null;
    }[];
    expect(properties.map((p) => p.property.id).sort()).toEqual(
      [A, B, org.properties.C!.id].sort(),
    );
    expect(properties.find((p) => p.property.id === B)!.property.currencyCode).toBe("AED");
    expect(properties.find((p) => p.property.id === org.properties.C!.id)!.today).toBeNull();
    // Request (3) + organization, properties, business dates (3) + 3 per live property.
    expect(statements).toBeLessThanOrEqual(3 + 3 + 3 * 2);
    // One business-date read for all properties (besides the session's own join).
    expect(texts.filter((t) => /FROM "public"\."business_dates"/.test(t))).toHaveLength(1);
  });
});

describe("night-audit readiness (B4)", () => {
  it("checks balances without re-summing closed history", async () => {
    const readiness = () =>
      call(readinessRoute, {
        path: `/api/v1/properties/${A}/night-audits/readiness`,
        params: { propertyId: A },
        jar: admin,
      });
    await readiness();
    const { result, texts } = await countStatements(readiness);
    expect(result.status).toBe(200);
    const balances = (result.body.data.checks as { code: string; outcome: string }[]).find(
      (c) => c.code === "VALIDATE_BALANCES",
    );
    expect(balances?.outcome).toBe("PASSED");
    const check = texts.find((t) => t.includes('"charges_total"'))!;
    expect(check).toContain(`"status" <> 'CLOSED'`);
  });
});
