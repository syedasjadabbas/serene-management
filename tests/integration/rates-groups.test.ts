import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as availabilityRoute } from "@/app/api/v1/properties/[propertyId]/availability/route";
import { POST as allocationRoute } from "@/app/api/v1/properties/[propertyId]/blocks/[blockId]/allocation/route";
import { POST as pickupRoute } from "@/app/api/v1/properties/[propertyId]/blocks/[blockId]/pickups/route";
import { POST as releaseRoute } from "@/app/api/v1/properties/[propertyId]/blocks/[blockId]/release/route";
import { POST as blockStatusRoute } from "@/app/api/v1/properties/[propertyId]/blocks/[blockId]/status/route";
import { POST as blocksRoute } from "@/app/api/v1/properties/[propertyId]/groups/[groupId]/blocks/route";
import { GET as groupRoute } from "@/app/api/v1/properties/[propertyId]/groups/[groupId]/route";
import {
  GET as groupsRoute,
  POST as createGroupRoute,
} from "@/app/api/v1/properties/[propertyId]/groups/route";
import { POST as packagesRoute } from "@/app/api/v1/properties/[propertyId]/packages/route";
import {
  GET as ratePlanRoute,
  PATCH as updatePlanRoute,
} from "@/app/api/v1/properties/[propertyId]/rate-plans/[ratePlanId]/route";
import { POST as seasonsRoute } from "@/app/api/v1/properties/[propertyId]/rate-plans/[ratePlanId]/seasons/route";
import { POST as createPlanRoute } from "@/app/api/v1/properties/[propertyId]/rate-plans/route";
import { GET as calendarRoute } from "@/app/api/v1/properties/[propertyId]/rates/calendar/route";
import { POST as cancelRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/cancel/route";
import { GET as estimateRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/charge-estimate/route";
import { POST as addPackageRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/packages/route";
import { PATCH as modifyRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as restrictionsRoute } from "@/app/api/v1/properties/[propertyId]/restrictions/route";
import { prisma } from "@/lib/db/prisma";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { addDays } from "@/modules/business-date/business-date.policy";
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
type Handler = typeof createPlanRoute;

let org: FixtureOrg;
let A: string;
let B: string;
let inv: Inventory;
let D: string;
let guestId: string;
let gm: CookieJar; // general manager @ A: rates, packages, restrictions, groups
let fom: CookieJar; // front office manager @ A: groups, no rate administration
let agent: CookieJar; // front desk agent @ A: bookings and pickups, read-only groups
let auditor: CookieJar; // read only @ A
let gmB: CookieJar; // general manager @ B only

const base = (propertyId = A) => `/api/v1/properties/${propertyId}`;

function send(
  route: Handler,
  jar: CookieJar,
  method: string,
  path: string,
  params: Record<string, string>,
  body?: Record<string, unknown>,
  options: { propertyId?: string; idempotencyKey?: string } = {},
) {
  const propertyId = options.propertyId ?? A;
  const headers: Record<string, string> = {};
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return call(route, {
    method,
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    body,
    jar,
    headers,
  });
}

const key = () => `t6-${randomUUID()}`;
const KNG = () => inv.roomTypes.KNG!.id;

async function quote(arrival: string, departure: string, adults = 1) {
  const r = await call(availabilityRoute, {
    path: `${base()}/availability?arrival=${arrival}&departure=${departure}&adults=${adults}&roomTypeId=${KNG()}`,
    params: { propertyId: A },
    jar: gm,
  });
  expect(r.status).toBe(200);
  return r.body.data.roomTypes[0] as {
    available: number;
    nights: { date: string; available: number }[];
    rates: {
      ratePlan: { code: string };
      bookable: boolean;
      unavailableReason: string | null;
      nightly: { date: string; amount: string }[];
    }[];
  };
}

async function book(ratePlanId: string, arrival: string, departure: string, adults = 1) {
  return send(
    createReservationRoute,
    gm,
    "POST",
    "/reservations",
    {},
    {
      arrival,
      departure,
      adults,
      roomTypeId: KNG(),
      ratePlanId,
      reservationTypeId: inv.reservationTypes.GTD!,
      guestId,
    },
  );
}

async function newGroup(code: string) {
  const r = await send(
    createGroupRoute,
    fom,
    "POST",
    "/groups",
    {},
    { code, name: `Group ${code}` },
  );
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

async function newBlock(
  groupId: string,
  options: {
    code: string;
    start: string;
    nights: number;
    rooms: number;
    status?: string;
    elastic?: boolean;
  },
) {
  const r = await send(
    blocksRoute,
    fom,
    "POST",
    `/groups/${groupId}/blocks`,
    { groupId },
    {
      code: options.code,
      name: `Block ${options.code}`,
      statusId: inv.blockStatuses[options.status ?? "DEF"],
      startDate: options.start,
      endDate: addDays(options.start, options.nights),
      ratePlanId: inv.ratePlans.GRP!,
      allocations: [{ roomTypeId: KNG(), rooms: options.rooms }],
      isElastic: options.elastic ?? false,
    },
  );
  if (r.status !== 201) throw new Error(`Block failed: ${JSON.stringify(r.body)}`);
  const block = (r.body.data.blocks as { id: string; code: string; version: number }[]).find(
    (b) => b.code === options.code,
  )!;
  return block;
}

async function blockState(groupId: string, blockId: string) {
  const r = await send(groupRoute, gm, "GET", `/groups/${groupId}`, { groupId });
  expect(r.status).toBe(200);
  return (
    r.body.data.blocks as {
      id: string;
      version: number;
      totals: { allocated: number; pickedUp: number; released: number; remaining: number };
    }[]
  ).find((b) => b.id === blockId)!;
}

function pick(blockId: string, body: Record<string, unknown>, jar = agent, k = key()) {
  return send(
    pickupRoute,
    jar,
    "POST",
    `/blocks/${blockId}/pickups`,
    { blockId },
    {
      guestId,
      roomTypeId: KNG(),
      adults: 1,
      ...body,
    },
    { idempotencyKey: k },
  );
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
  inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 12 }]);
  await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }]);
  D = inv.businessDate;
  guestId = (await createGuestRow(org, "Rita", "Rates")).id;
  const users = {
    gm: await createUser(org, "gm", [{ role: "GENERAL_MANAGER", property: "A" }]),
    fom: await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    auditor: await createUser(org, "auditor", [{ role: "AUDITOR", property: "A" }]),
    gmB: await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]),
  };
  gm = await loginAs(users.gm.email, TEST_PASSWORD);
  fom = await loginAs(users.fom.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
  auditor = await loginAs(users.auditor.email, TEST_PASSWORD);
  gmB = await loginAs(users.gmB.email, TEST_PASSWORD);
});

describe("rate plans", () => {
  const planBody = () => ({
    code: `C${randomUUID().slice(0, 6)}`,
    name: "Corporate (-20%)",
    kind: "CORPORATE",
    taxInclusive: false,
    roomTransactionCodeId: inv.chargeCodes["1000"],
    derivation: { parentRatePlanId: inv.ratePlans.BAR, type: "PERCENT", value: "-20" },
    roomTypeIds: [KNG()],
    defaultMarketCodeId: inv.marketCodes.COR,
    defaultSourceCodeId: inv.sourceCodes.DIR,
    reason: "Corporate contract 2026",
  });

  it("creates a derived plan priced by the booking engine, with HIGH audit", async () => {
    expect((await send(createPlanRoute, fom, "POST", "/rate-plans", {}, planBody())).status).toBe(
      403,
    );
    const noReason = { ...planBody(), reason: undefined };
    expect((await send(createPlanRoute, gm, "POST", "/rate-plans", {}, noReason)).status).toBe(400);
    const r = await send(createPlanRoute, gm, "POST", "/rate-plans", {}, planBody());
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ currencyCode: "PKR", status: "ACTIVE" });
    const arrival = addDays(D, 30);
    const q = await quote(arrival, addDays(arrival, 2));
    const bar = q.rates.find((rate) => rate.ratePlan.code === "BAR")!;
    const corp = q.rates.find((rate) => rate.ratePlan.code === r.body.data.code)!;
    corp.nightly.forEach((night, i) => {
      expect(parseMoney(night.amount)).toBe((parseMoney(bar.nightly[i]!.amount) * 80n) / 100n);
    });
    // The calendar shows the same prices (same engine).
    const cal = await call(calendarRoute, {
      path: `${base()}/rates/calendar?ratePlanId=${r.body.data.id}&roomTypeId=${KNG()}&from=${arrival}&to=${addDays(arrival, 1)}`,
      params: { propertyId: A },
      jar: auditor,
    });
    expect(cal.status).toBe(200);
    expect(
      cal.body.data.days.map((d: { oneAdult: string }) => formatMoney(parseMoney(d.oneAdult), 2)),
    ).toEqual(corp.nightly.map((n) => formatMoney(parseMoney(n.amount), 2)));
    const log = (await auditLogsFor(r.body.data.id)).find((l) => l.action === "rate_plan.create")!;
    expect(log.risk).toBe("HIGH");
    expect(log.reason).toBe("Corporate contract 2026");
  });

  it("rejects cycles, over-deep chains, inactive parents and stale edits", async () => {
    const created = await send(createPlanRoute, gm, "POST", "/rate-plans", {}, planBody());
    const plan = created.body.data as { id: string; version: number };
    const update = (id: string, body: Record<string, unknown>) =>
      send(updatePlanRoute, gm, "PATCH", `/rate-plans/${id}`, { ratePlanId: id }, body);
    const full = (overrides: Record<string, unknown>) => ({
      version: plan.version,
      name: "Corporate",
      kind: "CORPORATE",
      taxInclusive: false,
      roomTransactionCodeId: inv.chargeCodes["1000"],
      derivation: { parentRatePlanId: inv.ratePlans.BAR, type: "PERCENT", value: "-20" },
      roomTypeIds: [KNG()],
      status: "ACTIVE",
      reason: "Adjust contract",
      ...overrides,
    });
    // Self-parent.
    const self = await update(
      plan.id,
      full({ derivation: { parentRatePlanId: plan.id, type: "PERCENT", value: "-1" } }),
    );
    expect(self.status).toBe(422);
    // BAR cannot become derived from its own descendant (cycle); the database refuses it too.
    await expect(
      prisma.$executeRaw`UPDATE rate_plans SET parent_rate_plan_id = ${plan.id}::uuid, derivation_type = 'PERCENT', derivation_value = 1 WHERE id = ${inv.ratePlans.BAR}::uuid`,
    ).rejects.toThrow();
    // Deactivating a parent with active children is refused by the database.
    await expect(
      prisma.$executeRaw`UPDATE rate_plans SET status = 'INACTIVE' WHERE id = ${inv.ratePlans.BAR}::uuid`,
    ).rejects.toThrow();
    // …and by the service with a clear reason before it gets there.
    const barId = inv.ratePlans.BAR!;
    const bar = (
      await send(ratePlanRoute, gm, "GET", `/rate-plans/${barId}`, { ratePlanId: barId })
    ).body.data;
    const deactivate = await update(barId, {
      version: bar.version,
      name: bar.name,
      kind: bar.kind,
      taxInclusive: bar.taxInclusive,
      roomTransactionCodeId: bar.roomTransactionCode.id,
      derivation: null,
      roomTypeIds: bar.roomTypeIds,
      status: "INACTIVE",
      reason: "Retire BAR",
    });
    expect(deactivate.status).toBe(422);
    expect(deactivate.body.error.details.reason).toBe("PLAN_HAS_ACTIVE_CHILDREN");
    // Two concurrent edits of the same version: one wins, the other gets 409.
    const [a, b] = await Promise.all([
      update(plan.id, full({ name: "Corporate A" })),
      update(plan.id, full({ name: "Corporate B" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    // A derived plan has no seasons of its own.
    const current = (
      await send(ratePlanRoute, gm, "GET", `/rate-plans/${plan.id}`, { ratePlanId: plan.id })
    ).body.data;
    const season = await send(
      seasonsRoute,
      gm,
      "POST",
      `/rate-plans/${plan.id}/seasons`,
      { ratePlanId: plan.id },
      {
        version: current.version,
        name: "S",
        startDate: D,
        endDate: addDays(D, 10),
        daysOfWeek: 127,
        priority: 0,
        amounts: [{ roomTypeId: KNG(), oneAdult: "5000" }],
        reason: "Seasons",
      },
    );
    expect(season.status).toBe(422);
    expect(season.body.error.details.reason).toBe("PLAN_IS_DERIVED");
  });

  it("refuses ambiguous seasons and applies higher-priority overrides", async () => {
    const created = await send(
      createPlanRoute,
      gm,
      "POST",
      "/rate-plans",
      {},
      {
        ...planBody(),
        name: "Flat base",
        kind: "RACK",
        derivation: null,
      },
    );
    let plan = created.body.data as { id: string; version: number };
    const addSeason = (body: Record<string, unknown>) =>
      send(
        seasonsRoute,
        gm,
        "POST",
        `/rate-plans/${plan.id}/seasons`,
        { ratePlanId: plan.id },
        {
          version: plan.version,
          daysOfWeek: 127,
          amounts: [{ roomTypeId: KNG(), oneAdult: "9000.00", twoAdults: "9500.00" }],
          reason: "Price list",
          ...body,
        },
      );
    let r = await addSeason({ name: "Year", startDate: D, endDate: addDays(D, 90), priority: 0 });
    expect(r.status).toBe(201);
    plan = r.body.data;
    const clash = await addSeason({
      name: "Clash",
      startDate: addDays(D, 40),
      endDate: addDays(D, 42),
      priority: 0,
    });
    expect(clash.status).toBe(422);
    expect(clash.body.error.details.reason).toBe("SEASON_CONFLICT");
    const precision = await addSeason({
      name: "Bad",
      startDate: addDays(D, 40),
      endDate: addDays(D, 42),
      priority: 5,
      amounts: [{ roomTypeId: KNG(), oneAdult: "9000.005" }],
    });
    expect(precision.status).toBe(400);
    r = await addSeason({
      name: "Event",
      startDate: addDays(D, 40),
      endDate: addDays(D, 41),
      priority: 50,
      amounts: [{ roomTypeId: KNG(), oneAdult: "15000.00" }],
    });
    expect(r.status).toBe(201);
    const cal = await call(calendarRoute, {
      path: `${base()}/rates/calendar?ratePlanId=${plan.id}&roomTypeId=${KNG()}&from=${addDays(D, 39)}&to=${addDays(D, 42)}`,
      params: { propertyId: A },
      jar: gm,
    });
    expect(
      cal.body.data.days.map((d: { oneAdult: string; seasonName: string }) => [
        d.seasonName,
        d.oneAdult,
      ]),
    ).toEqual([
      ["Year", "9000.00"],
      ["Event", "15000.00"],
      ["Event", "15000.00"],
      ["Year", "9000.00"],
    ]);
  });

  it("keeps a group rate out of public quotes and bookings", async () => {
    const arrival = addDays(D, 31);
    const q = await quote(arrival, addDays(arrival, 1));
    expect(q.rates.map((rate) => rate.ratePlan.code)).not.toContain("GRP");
    const r = await book(inv.ratePlans.GRP!, arrival, addDays(arrival, 1));
    expect(r.status).toBe(422);
    expect(r.body.error.details.reason).toBe("RATE_NOT_SELLABLE");
  });

  it("prices a booking consistently while the rate changes concurrently", async () => {
    const created = await send(
      createPlanRoute,
      gm,
      "POST",
      "/rate-plans",
      {},
      {
        ...planBody(),
        name: "Race base",
        kind: "RACK",
        derivation: null,
      },
    );
    let plan = created.body.data as { id: string; version: number };
    const s = await send(
      seasonsRoute,
      gm,
      "POST",
      `/rate-plans/${plan.id}/seasons`,
      { ratePlanId: plan.id },
      {
        version: plan.version,
        name: "Base",
        startDate: D,
        endDate: addDays(D, 120),
        daysOfWeek: 127,
        priority: 0,
        amounts: [{ roomTypeId: KNG(), oneAdult: "7000.00" }],
        reason: "Initial",
      },
    );
    plan = s.body.data;
    const arrival = addDays(D, 50);
    const [booked, raised] = await Promise.all([
      book(plan.id, arrival, addDays(arrival, 3)),
      send(
        seasonsRoute,
        gm,
        "POST",
        `/rate-plans/${plan.id}/seasons`,
        { ratePlanId: plan.id },
        {
          version: plan.version,
          name: "Raise",
          startDate: D,
          endDate: addDays(D, 120),
          daysOfWeek: 127,
          priority: 10,
          amounts: [{ roomTypeId: KNG(), oneAdult: "8000.00" }],
          reason: "Price rise",
        },
      ),
    ]);
    expect(booked.status).toBe(201);
    expect(raised.status).toBe(201);
    const nights = await prisma.reservationRoomNight.findMany({
      where: { reservationRoomId: booked.body.data.rooms[0].id },
    });
    const amounts = new Set(nights.map((n) => n.rateAmount.toFixed(2)));
    // Every night of one booking is priced from the same version of the plan.
    expect(amounts.size).toBe(1);
    expect(["7000.00", "8000.00"]).toContain([...amounts][0]);
  });
});

describe("restrictions", () => {
  it("are enforced by the availability engine and booking, with HIGH audit", async () => {
    const arrival = addDays(D, 60);
    const body = {
      action: "set",
      type: "CLOSED_TO_ARRIVAL",
      from: arrival,
      to: arrival,
      ratePlanId: inv.ratePlans.BAR,
      reason: "Event: no arrivals",
    };
    expect((await send(restrictionsRoute, auditor, "POST", "/restrictions", {}, body)).status).toBe(
      403,
    );
    expect(
      (
        await send(
          restrictionsRoute,
          gm,
          "POST",
          "/restrictions",
          {},
          { ...body, reason: undefined },
        )
      ).status,
    ).toBe(400);
    const r = await send(restrictionsRoute, gm, "POST", "/restrictions", {}, body);
    expect(r.status).toBe(200);
    let q = await quote(arrival, addDays(arrival, 2));
    const bar = q.rates.find((rate) => rate.ratePlan.code === "BAR")!;
    expect(bar).toMatchObject({ bookable: false, unavailableReason: "RESTRICTED" });
    // Derived plans are not closed by a BAR-only restriction.
    expect(q.rates.find((rate) => rate.ratePlan.code === "ADV")!.bookable).toBe(true);
    const refused = await book(inv.ratePlans.BAR!, arrival, addDays(arrival, 2));
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe("RESTRICTED");

    // A house-wide minimum stay applies to every plan.
    await send(
      restrictionsRoute,
      gm,
      "POST",
      "/restrictions",
      {},
      {
        action: "set",
        type: "MIN_LOS",
        from: arrival,
        to: arrival,
        value: 3,
        reason: "Event minimum stay",
      },
    );
    q = await quote(arrival, addDays(arrival, 2));
    expect(q.rates.every((rate) => !rate.bookable)).toBe(true);

    await send(restrictionsRoute, gm, "POST", "/restrictions", {}, { ...body, action: "clear" });
    await send(
      restrictionsRoute,
      gm,
      "POST",
      "/restrictions",
      {},
      {
        action: "clear",
        type: "MIN_LOS",
        from: arrival,
        to: arrival,
        reason: "Event cancelled",
      },
    );
    q = await quote(arrival, addDays(arrival, 2));
    expect(q.rates.find((rate) => rate.ratePlan.code === "BAR")!.bookable).toBe(true);
    const logs = await prisma.auditLog.findMany({
      where: { propertyId: A, action: { in: ["restriction.set", "restriction.clear"] } },
    });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs.every((l) => l.risk === "HIGH")).toBe(true);
  });
});

describe("packages", () => {
  it("prices a package rate by carving the included breakfast out of the room line", async () => {
    const arrival = addDays(D, 70);
    const r = await book(inv.ratePlans.BBK!, arrival, addDays(arrival, 2), 2);
    expect(r.status).toBe(201);
    const room = r.body.data.rooms[0];
    const estimate = await send(
      estimateRoute,
      gm,
      "GET",
      `/reservation-rooms/${room.id}/charge-estimate`,
      {
        reservationRoomId: room.id,
      },
    );
    expect(estimate.status).toBe(200);
    for (const night of estimate.body.data.nights) {
      const roomLine = night.lines.find((l: { kind: string }) => l.kind === "ROOM");
      const breakfast = night.lines.find((l: { kind: string }) => l.kind === "PACKAGE");
      expect(breakfast).toMatchObject({ code: "2030", quantity: 2, net: "3000.0000" });
      // Included in rate: room + breakfast = the nightly rate (no taxes in this fixture).
      expect(parseMoney(roomLine.net) + parseMoney(breakfast.net)).toBe(parseMoney(night.rate));
      expect(night.total).toBe(night.rate);
    }
  });

  it("books a separately sold package on future nights and posts it through billing's engine", async () => {
    const created = await send(
      packagesRoute,
      gm,
      "POST",
      "/packages",
      {},
      {
        code: `PK${randomUUID().slice(0, 4)}`.toUpperCase(),
        name: "Airport transfer",
        postingType: "SEPARATE_LINE",
        sellSeparately: true,
        components: [
          {
            name: "Transfer",
            transactionCodeId: inv.chargeCodes["3020"],
            calculation: "PER_ROOM",
            rhythm: "ARRIVAL_NIGHT",
            unitPrice: "2500.00",
          },
        ],
      },
    );
    expect(created.status).toBe(201);
    expect(
      (await send(packagesRoute, fom, "POST", "/packages", {}, { code: "X", name: "x" })).status,
    ).toBe(403);
    const arrival = addDays(D, 72);
    const booking = await book(inv.ratePlans.BAR!, arrival, addDays(arrival, 2));
    const room = booking.body.data.rooms[0];
    const added = await send(
      addPackageRoute,
      gm,
      "POST",
      `/reservation-rooms/${room.id}/packages`,
      {
        reservationRoomId: room.id,
      },
      { packageId: created.body.data.id, startDate: arrival, endDate: addDays(arrival, 1) },
    );
    expect(added.status).toBe(201);
    expect(added.body.data.rooms[0].packages).toHaveLength(1);
    const estimate = await send(
      estimateRoute,
      gm,
      "GET",
      `/reservation-rooms/${room.id}/charge-estimate`,
      {
        reservationRoomId: room.id,
      },
    );
    const [first, second] = estimate.body.data.nights;
    expect(first.lines.filter((l: { kind: string }) => l.kind === "PACKAGE")).toHaveLength(1);
    expect(second.lines.filter((l: { kind: string }) => l.kind === "PACKAGE")).toHaveLength(0);
    // Past nights cannot get packages.
    const past = await send(
      addPackageRoute,
      gm,
      "POST",
      `/reservation-rooms/${room.id}/packages`,
      {
        reservationRoomId: room.id,
      },
      { packageId: created.body.data.id, startDate: addDays(arrival, -1), endDate: arrival },
    );
    expect(past.status).toBe(400);
  });

  it("adds an 'included' package booked on the reservation on top of the room rate", async () => {
    // BB is INCLUDED_IN_RATE (for BBK) and sold separately: on a BAR stay it
    // was never part of the rate, so it must not be carved out of the room line.
    const arrival = addDays(D, 74);
    const booking = await book(inv.ratePlans.BAR!, arrival, addDays(arrival, 1), 2);
    const room = booking.body.data.rooms[0];
    const estimateOf = async () =>
      (
        await send(estimateRoute, gm, "GET", `/reservation-rooms/${room.id}/charge-estimate`, {
          reservationRoomId: room.id,
        })
      ).body.data;
    const before = await estimateOf();
    const added = await send(
      addPackageRoute,
      gm,
      "POST",
      `/reservation-rooms/${room.id}/packages`,
      { reservationRoomId: room.id },
      { packageId: inv.packages.BB, startDate: arrival, endDate: arrival },
    );
    expect(added.status).toBe(201);
    const after = await estimateOf();
    const roomLine = (e: typeof before) =>
      e.nights[0].lines.find((l: { kind: string }) => l.kind === "ROOM");
    const breakfast = after.nights[0].lines.find((l: { kind: string }) => l.kind === "PACKAGE");
    expect(roomLine(after).net).toBe(roomLine(before).net);
    expect(breakfast).toMatchObject({ quantity: 2, net: "3000.0000" });
    expect(parseMoney(after.total)).toBe(parseMoney(before.total) + parseMoney(breakfast.total));
  });
});

describe("groups and blocks", () => {
  it("holds definite inventory, picks up at the block rate and releases on cancellation", async () => {
    const start = addDays(D, 80);
    const before = await quote(start, addDays(start, 3));
    const groupId = await newGroup(`G${randomUUID().slice(0, 5)}`.toUpperCase());
    const block = await newBlock(groupId, { code: "B80", start, nights: 3, rooms: 5 });
    const held = await quote(start, addDays(start, 3));
    expect(held.available).toBe(before.available - 5);

    // The agent cannot manage the group but can pick up rooms.
    expect(
      (await send(blocksRoute, agent, "POST", `/groups/${groupId}/blocks`, { groupId }, {})).status,
    ).toBe(403);
    const r = await pick(block.id, { arrival: start, departure: addDays(start, 3) });
    expect(r.status).toBe(201);
    const after = await quote(start, addDays(start, 3));
    expect(after.available).toBe(held.available); // pickup inside the allocation
    const state = await blockState(groupId, block.id);
    expect(state.totals).toMatchObject({ allocated: 15, pickedUp: 3, remaining: 12 });

    const rr = await prisma.reservationRoom.findFirstOrThrow({
      where: { reservationId: r.body.data.reservationId },
      include: { reservation: true, nights: true },
    });
    expect(rr.blockId).toBe(block.id);
    expect(rr.reservation.groupId).toBe(groupId);
    expect(rr.ratePlanId).toBe(inv.ratePlans.GRP);
    // Group rate = BAR − 15% (rounded to whole units), priced by the server.
    const bar = before.rates.find((rate) => rate.ratePlan.code === "BAR")!;
    rr.nights
      .sort((x, y) => x.stayDate.getTime() - y.stayDate.getTime())
      .forEach((night, i) => {
        const expected = (parseMoney(bar.nightly[i]!.amount) * 85n) / 100n;
        expect(parseMoney(night.rateAmount.toFixed(4))).toBe((expected / 10000n) * 10000n);
      });

    // A pickup's dates and rate belong to the block.
    const modified = await send(
      modifyRoute,
      agent,
      "PATCH",
      `/reservation-rooms/${rr.id}`,
      {
        reservationRoomId: rr.id,
      },
      { version: rr.version, departure: addDays(start, 2) },
    );
    expect(modified.status).toBe(422);
    expect(modified.body.error.details.reason).toBe("BLOCK_PICKUP_LOCKED");

    const cancelled = await send(
      cancelRoute,
      agent,
      "POST",
      `/reservation-rooms/${rr.id}/cancel`,
      {
        reservationRoomId: rr.id,
      },
      {
        version: rr.version,
        reasonCodeId: inv.reasonCodes["CANCELLATION:GUEST"],
        reason: "Guest cancelled",
      },
    );
    expect(cancelled.status).toBe(200);
    expect((await blockState(groupId, block.id)).totals).toMatchObject({
      pickedUp: 0,
      remaining: 15,
    });
    expect((await quote(start, addDays(start, 3))).available).toBe(held.available);
    const alloc = await prisma.blockAllocation.findMany({ where: { blockId: block.id } });
    expect(alloc.every((a) => a.pickedUp === 0)).toBe(true);
    const actions = (await auditLogsFor(block.id)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["block.create", "block.pickup"]));
  });

  it("never picks up more than the block holds (final room race, 2+2+1+1 into 5)", async () => {
    const start = addDays(D, 90);
    const groupId = await newGroup(`R${randomUUID().slice(0, 5)}`.toUpperCase());
    const block = await newBlock(groupId, { code: "B90", start, nights: 2, rooms: 5 });
    const results = await Promise.all(
      [2, 2, 1, 1].map((rooms) =>
        pick(block.id, { arrival: start, departure: addDays(start, 2), rooms }),
      ),
    );
    const booked = results
      .map((r, i) => (r.status === 201 ? [2, 2, 1, 1][i]! : 0))
      .reduce((s, n) => s + n, 0);
    expect(booked).toBeLessThanOrEqual(5);
    results
      .filter((r) => r.status !== 201)
      .forEach((r) => {
        expect(r.status).toBe(422);
        expect(r.body.error.details.reason).toBe("BLOCK_EXHAUSTED");
      });
    const state = await blockState(groupId, block.id);
    expect(state.totals.pickedUp).toBe(booked * 2);
    expect(state.totals.remaining).toBe(10 - booked * 2);

    // One room left: two agents race for it.
    const one = await newBlock(groupId, { code: "B91", start, nights: 1, rooms: 1 });
    const [x, y] = await Promise.all([
      pick(one.id, { arrival: start, departure: addDays(start, 1) }),
      pick(one.id, { arrival: start, departure: addDays(start, 1) }, fom),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 422]);
  });

  it("replays a duplicated pickup instead of booking twice", async () => {
    const start = addDays(D, 95);
    const groupId = await newGroup(`D${randomUUID().slice(0, 5)}`.toUpperCase());
    const block = await newBlock(groupId, { code: "B95", start, nights: 1, rooms: 3 });
    const k = key();
    const [a, b] = await Promise.all([
      pick(block.id, { arrival: start, departure: addDays(start, 1) }, agent, k),
      pick(block.id, { arrival: start, departure: addDays(start, 1) }, agent, k),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.reservationId).toBe(b.body.data.reservationId);
    expect((await blockState(groupId, block.id)).totals.pickedUp).toBe(1);
  });

  it("keeps pickup plus release within the allocation when they race", async () => {
    for (let round = 0; round < 3; round++) {
      const start = addDays(D, 100 + round * 3);
      const groupId = await newGroup(`L${randomUUID().slice(0, 5)}`.toUpperCase());
      const block = await newBlock(groupId, { code: `BL${round}`, start, nights: 2, rooms: 2 });
      const [p, rel] = await Promise.all([
        pick(block.id, { arrival: start, departure: addDays(start, 2) }),
        send(
          releaseRoute,
          fom,
          "POST",
          `/blocks/${block.id}/release`,
          { blockId: block.id },
          {
            version: block.version,
            reason: "Wash at cutoff",
          },
          { idempotencyKey: key() },
        ),
      ]);
      const rows = await prisma.blockAllocation.findMany({ where: { blockId: block.id } });
      rows.forEach((row) => expect(row.pickedUp + row.released).toBeLessThanOrEqual(row.allocated));
      if (p.status === 201) {
        // Picked first: the release still returned the second room (or it retried on the new version).
        expect([201, 409]).toContain(rel.status);
      } else {
        expect(rel.status).toBe(201);
        expect(p.body.error.details.reason).toBe("BLOCK_EXHAUSTED");
      }
    }
  });

  it("follows the block status rules with inventory effects", async () => {
    const start = addDays(D, 115);
    const base0 = (await quote(start, addDays(start, 1))).available;
    const groupId = await newGroup(`S${randomUUID().slice(0, 5)}`.toUpperCase());
    const tentative = await newBlock(groupId, {
      code: "BT1",
      start,
      nights: 1,
      rooms: 4,
      status: "TENT",
    });
    expect((await quote(start, addDays(start, 1))).available).toBe(base0); // not deducted
    const noPickup = await pick(tentative.id, { arrival: start, departure: addDays(start, 1) });
    expect(noPickup.status).toBe(422);
    let r = await send(
      blockStatusRoute,
      fom,
      "POST",
      `/blocks/${tentative.id}/status`,
      { blockId: tentative.id },
      {
        version: tentative.version,
        statusId: inv.blockStatuses.DEF,
      },
    );
    expect(r.status).toBe(200);
    expect((await quote(start, addDays(start, 1))).available).toBe(base0 - 4);
    const picked = await pick(tentative.id, { arrival: start, departure: addDays(start, 1) });
    expect(picked.status).toBe(201);
    const state = await blockState(groupId, tentative.id);
    r = await send(
      blockStatusRoute,
      fom,
      "POST",
      `/blocks/${tentative.id}/status`,
      { blockId: tentative.id },
      {
        version: state.version,
        statusId: inv.blockStatuses.LOST,
      },
    );
    expect(r.status).toBe(422);
    // Allocation cannot drop below pickup.
    r = await send(
      allocationRoute,
      fom,
      "POST",
      `/blocks/${tentative.id}/allocation`,
      { blockId: tentative.id },
      {
        version: state.version,
        roomTypeId: KNG(),
        from: start,
        to: start,
        rooms: 0,
      },
    );
    expect(r.status).toBe(422);
    expect(r.body.error.details.reason).toBe("ALLOCATION_BELOW_PICKUP");
    // A definite block cannot hold more than the house has.
    const tooBig = await send(
      blocksRoute,
      fom,
      "POST",
      `/groups/${groupId}/blocks`,
      { groupId },
      {
        code: "BIG",
        name: "Too big",
        statusId: inv.blockStatuses.DEF,
        startDate: start,
        endDate: addDays(start, 1),
        ratePlanId: inv.ratePlans.GRP,
        allocations: [{ roomTypeId: KNG(), rooms: 50 }],
      },
    );
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.details.reason).toBe("BLOCK_NO_AVAILABILITY");
    // The database refuses pickup beyond a non-elastic allocation.
    await expect(
      prisma.$executeRaw`UPDATE block_allocations SET picked_up = allocated + 1 WHERE block_id = ${tentative.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE block_allocations SET released = allocated + 1 WHERE block_id = ${tentative.id}::uuid`,
    ).rejects.toThrow();
  });
});

describe("security and isolation", () => {
  it("keeps commercial inventory property-scoped and read-only for auditors", async () => {
    const groupId = await newGroup(`I${randomUUID().slice(0, 5)}`.toUpperCase());
    expect(
      (
        await send(groupRoute, gmB, "GET", `/groups/${groupId}`, { groupId }, undefined, {
          propertyId: B,
        })
      ).status,
    ).toBe(404);
    expect((await send(groupRoute, gmB, "GET", `/groups/${groupId}`, { groupId })).status).toBe(
      403,
    );
    const plan = inv.ratePlans.BAR!;
    expect(
      (
        await send(
          ratePlanRoute,
          gmB,
          "GET",
          `/rate-plans/${plan}`,
          { ratePlanId: plan },
          undefined,
          { propertyId: B },
        )
      ).status,
    ).toBe(404);
    expect((await send(groupsRoute, auditor, "GET", "/groups", {})).status).toBe(200);
    expect(
      (await send(ratePlanRoute, auditor, "GET", `/rate-plans/${plan}`, { ratePlanId: plan }))
        .status,
    ).toBe(200);
    expect(
      (await send(createGroupRoute, auditor, "POST", "/groups", {}, { code: "NOPE", name: "x" }))
        .status,
    ).toBe(403);
    const before = await prisma.group.count({ where: { propertyId: A } });
    expect((await send(createPlanRoute, auditor, "POST", "/rate-plans", {}, {})).status).toBe(403);
    expect(await prisma.group.count({ where: { propertyId: A } })).toBe(before);
  });
});
