import { beforeAll, describe, expect, it } from "vitest";
import { GET as businessDateRoute } from "@/app/api/v1/properties/[propertyId]/business-date/route";
import type { PropertyContext } from "@/lib/http/context";
import { ALL_PERMISSIONS } from "@/lib/permissions/catalog";
import { localDateInZone } from "@/modules/business-date/business-date.policy";
import { initializeBusinessDate } from "@/modules/business-date/business-date.service";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";
import { countStatements } from "./support/statements";

/**
 * Per-request overhead (M10): what every property API call costs before its
 * handler runs. The session, user and organization come in one statement;
 * the accessible properties come with their current business dates, so the
 * route needs no separate business-date read. Nothing is cached across
 * requests: authorization and business dates are always current.
 */

let org: FixtureOrg;
let A: string;
let B: string;
let C: string;
let agentA: CookieJar;
let gmB: CookieJar;
let admin: CookieJar;

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
      { key: "C", timezone: "Asia/Karachi", live: false },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  C = org.properties.C!.id;
  agentA = await loginAs(
    (await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }])).email,
    TEST_PASSWORD,
  );
  gmB = await loginAs(
    (await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }])).email,
    TEST_PASSWORD,
  );
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
}, 120_000);

const businessDate = (jar: CookieJar, propertyId: string) =>
  call(businessDateRoute, {
    path: `/api/v1/properties/${propertyId}/business-date`,
    params: { propertyId },
    jar,
  });

describe("request overhead (M10)", () => {
  it("authenticates and scopes a property request in three statements", async () => {
    await businessDate(agentA, A); // warm-up (connection, prepared plans)
    const { result, statements, texts } = await countStatements(() => businessDate(agentA, A));
    expect(result.status).toBe(200);
    // Session+user+organization, grants, properties with business dates — then the
    // handler's own read of the business-date view. Was 7 (6 before the handler).
    expect(statements).toBe(4);
    expect(texts.filter((t) => /"business_dates"/.test(t))).toHaveLength(2);
  });

  it("keeps users and properties isolated", async () => {
    expect((await businessDate(gmB, A)).status).toBe(403);
    expect((await businessDate(agentA, B)).status).toBe(403);
    const ownB = await businessDate(gmB, B);
    expect(ownB.status).toBe(200);
    expect(ownB.body.data.businessDate).toEqual(expect.any(String));
  });

  it("sees a business date change on the very next request (no cross-request cache)", async () => {
    const before = await businessDate(admin, C);
    expect(before.status).toBe(200);
    expect(before.body.data.businessDate).toBeNull();
    const ctx: PropertyContext = {
      ...org.adminCtx,
      access: { ...org.adminCtx.access, byProperty: { [C]: ALL_PERMISSIONS } },
      propertyId: C,
      propertyCode: "C",
      timezone: "Asia/Karachi",
      currencyCode: "PKR",
      businessDate: null,
    };
    const today = localDateInZone(new Date(), "Asia/Karachi");
    await initializeBusinessDate(ctx, { date: today, reason: "Go live" });
    const after = await businessDate(admin, C);
    expect(after.body.data.businessDate).toBe(today);
  });
});
