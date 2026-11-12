import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { clearMemoryCache } from "@/lib/cache";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { type Session, call, loginAs, route } from "./support/http";
import { drainJobs } from "./support/jobs";
import { countStatements } from "./support/statements";

/**
 * Closed-range report cache (lib/report-cache.ts): a repeated closed range is
 * served without touching the database, restricted callers never see a result
 * cached for a financial caller, and a range that reaches the open date is
 * never cached.
 */

const P = "/properties/:propertyId";
const reportRoute = route("GET", `${P}/reports/:reportKey`);
const startRoute = route("POST", `${P}/night-audits`);

let A: string;
let D: string;
let fom: Session;
let agent: Session;
let open: string;

const run = (jar: Session, reportKey: string, query: Record<string, string>) =>
  countStatements(() => call(reportRoute, { params: { propertyId: A, reportKey }, query, jar }));
const statsReads = (texts: string[]) => texts.filter((t) => t.includes("daily_statistics")).length;
const columns = (r: { body: { data: { columns: { key: string }[] } } }) =>
  r.body.data.columns.map((c) => c.key);

beforeAll(async () => {
  const org: FixtureOrg = await createFixtureOrg({
    properties: [{ key: "A", timezone: "Asia/Karachi" }],
  });
  A = org.properties.A!.id;
  const inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 4 }]);
  D = inv.businessDate;
  fom = await loginAs(
    (await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }])).email,
    TEST_PASSWORD,
  );
  agent = await loginAs(
    (await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }])).email,
    TEST_PASSWORD,
  );
  const audit = await call(startRoute, {
    params: { propertyId: A },
    body: { reason: "Close" },
    jar: fom,
    headers: { "idempotency-key": `rc-${randomUUID()}` },
  });
  if (audit.status !== 202) throw new Error(JSON.stringify(audit.body));
  await drainJobs(A);
  open = addDays(D, 1);
  clearMemoryCache();
});

describe("closed ranges", () => {
  it("serves an identical second request from the cache", async () => {
    clearMemoryCache();
    const first = await run(fom, "occupancy", { from: D, to: D });
    expect(first.result.status).toBe(200);
    expect(statsReads(first.texts)).toBeGreaterThan(0);
    const second = await run(fom, "occupancy", { from: D, to: D });
    expect(second.result.status).toBe(200);
    expect(statsReads(second.texts)).toBe(0);
    expect(second.result.body.data.rows).toEqual(first.result.body.data.rows);
  });

  it("keys by parameters, not by their order, and separates different parameters", async () => {
    clearMemoryCache();
    await run(fom, "occupancy", { from: D, to: D });
    const reordered = await run(fom, "occupancy", { to: D, from: D });
    expect(statsReads(reordered.texts)).toBe(0);
    const wider = await run(fom, "occupancy", { from: addDays(D, -2), to: D });
    expect(statsReads(wider.texts)).toBeGreaterThan(0);
    expect(wider.result.body.data.params.from).toBe(addDays(D, -2));
  });

  it("never hands a financial result to a caller without reports:financial, nor the reverse", async () => {
    clearMemoryCache();
    const byManager = await run(fom, "occupancy", { from: D, to: D });
    expect(columns(byManager.result)).toContain("roomRevenue");
    const byAgent = await run(agent, "occupancy", { from: D, to: D });
    expect(byAgent.result.status).toBe(200);
    expect(columns(byAgent.result)).not.toContain("roomRevenue");
    expect(columns(byAgent.result)).not.toContain("adr");

    clearMemoryCache();
    const agentFirst = await run(agent, "occupancy", { from: D, to: D });
    expect(columns(agentFirst.result)).not.toContain("roomRevenue");
    const managerAfter = await run(fom, "occupancy", { from: D, to: D });
    expect(columns(managerAfter.result)).toContain("roomRevenue");
  });

  it("still enforces the report permission before the cache", async () => {
    clearMemoryCache();
    expect((await run(fom, "revenue-by-code", { from: D, to: D })).result.status).toBe(200);
    expect((await run(agent, "revenue-by-code", { from: D, to: D })).result.status).toBe(403);
  });
});

describe("open dates", () => {
  it("never caches a range that reaches the open business date", async () => {
    clearMemoryCache();
    for (const query of [
      { from: open, to: open },
      { from: D, to: open },
    ]) {
      const first = await run(fom, "occupancy", query);
      const second = await run(fom, "occupancy", query);
      expect(first.result.status).toBe(200);
      expect(statsReads(first.texts)).toBeGreaterThan(0);
      expect(statsReads(second.texts)).toBeGreaterThan(0);
    }
  });
});
