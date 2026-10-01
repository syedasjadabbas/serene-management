import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { GET as eventsRoute } from "@/app/api/v1/properties/[propertyId]/events/route";
import { prisma } from "@/lib/db/prisma";
import { serverEnv } from "@/lib/env";
import type { PropertyContext } from "@/lib/http/context";
import { ALL_PERMISSIONS } from "@/lib/permissions/catalog";
import { type HubEvent, RealtimeHub, realtimeHub } from "@/lib/realtime/hub";
import { localDateInZone } from "@/modules/business-date/business-date.policy";
import { initializeBusinessDate } from "@/modules/business-date/business-date.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createCustomUser,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { type CookieJar, ORIGIN, call, loginAs, testIp } from "./support/http";

/**
 * Live updates (docs/SCALABILITY.md §31): database triggers NOTIFY changes,
 * every instance LISTENs, and each event stream forwards only its own
 * property's topics that the user may read — as topic names, never data.
 */

let org: FixtureOrg;
let other: FixtureOrg;
let A: string;
let B: string;
let C: string;
let X: string;
let roomA: string;
let roomB: string;
let roomX: string;
let admin: CookieJar;
let otherAdmin: CookieJar;

interface Received {
  event: string;
  data: Record<string, unknown>;
}

/** Opens a stream in-process and reads its events. */
async function openStream(jar: CookieJar | null, propertyId: string) {
  const abort = new AbortController();
  const headers = new Headers({ "x-forwarded-for": testIp(), "user-agent": "vitest-integration" });
  if (jar) headers.set("cookie", jar.header());
  const request = new NextRequest(new URL(`/api/v1/properties/${propertyId}/events`, ORIGIN), {
    headers,
    signal: abort.signal,
  });
  const response = await eventsRoute(request, { params: Promise.resolve({ propertyId }) });
  const received: Received[] = [];
  let ended = false;
  let buffer = "";
  if (response.status === 200 && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split: number;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (event && data) received.push({ event, data: JSON.parse(data) });
          }
        }
      } catch {
        // aborted
      }
      ended = true;
    })();
  }
  const waitFor = async (predicate: (e: Received) => boolean, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = received.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };
  const waitLive = async () =>
    (await waitFor((e) => e.event === "ready" && e.data.live === true, 200)) ??
    (await waitFor((e) => e.event === "live"));
  return {
    response,
    received,
    waitFor,
    waitLive,
    ended: () => ended,
    close: () => abort.abort(),
  };
}

const changes = (s: { received: Received[] }) => s.received.filter((e) => e.event === "change");
const settle = () => new Promise((r) => setTimeout(r, 1_200));

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
      { key: "C", timezone: "Asia/Karachi", live: false },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  C = org.properties.C!.id;
  X = other.properties.X!.id;
  roomA = (await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 2 }])).roomTypes.KNG!
    .roomIds[0]!;
  roomB = (await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }])).roomTypes.KNG!
    .roomIds[0]!;
  roomX = (await buildFixtureInventory(other, "X", [{ code: "KNG", rooms: 2 }])).roomTypes.KNG!
    .roomIds[0]!;
  admin = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
  otherAdmin = await loginAs(`admin.${other.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
}, 180_000);

afterAll(async () => {
  await realtimeHub().stop();
});

const touchRoom = (roomId: string) =>
  prisma.room.update({ where: { id: roomId }, data: { version: { increment: 1 } } });

describe("event stream: access", () => {
  it("requires a session and access to the property", async () => {
    expect((await openStream(null, A)).response.status).toBe(401);
    expect((await openStream(otherAdmin, A)).response.status).toBe(403);
    const agent = await loginAs(
      (await createUser(org, "rt-agent", [{ role: "FRONT_DESK_AGENT", property: "A" }])).email,
      TEST_PASSWORD,
    );
    expect((await openStream(agent, B)).response.status).toBe(403);
    const ok = await openStream(agent, A);
    expect(ok.response.status).toBe(200);
    expect(ok.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(ok.response.headers.get("cache-control")).toBe("no-store, no-transform");
    ok.close();
  });

  it("offers only the topics the user may read at the property", async () => {
    const hk = await loginAs(
      (
        await createCustomUser(org, "rt-hk", [
          { permissions: ["housekeeping:read"], property: "A" },
        ])
      ).email,
      TEST_PASSWORD,
    );
    const stream = await openStream(hk, A);
    const ready = await stream.waitFor((e) => e.event === "ready");
    expect(ready?.data.topics).toEqual(["housekeeping", "businessdate"]);
    await stream.waitLive();
    // A room change concerns frontdesk, rooms and housekeeping: only housekeeping arrives.
    await touchRoom(roomA);
    const change = await stream.waitFor((e) => e.event === "change");
    expect(change?.data).toEqual({ t: ["housekeeping"], x: expect.any(String) });
    stream.close();
  });
});

describe("event stream: delivery and isolation", () => {
  it("delivers a committed change to its property only, as topic names, never across organizations", async () => {
    const atA = await openStream(admin, A);
    const atB = await openStream(admin, B);
    const atX = await openStream(otherAdmin, X);
    await Promise.all([atA.waitLive(), atB.waitLive(), atX.waitLive()]);

    await touchRoom(roomA);
    const change = await atA.waitFor((e) => e.event === "change");
    expect(change).not.toBeNull();
    expect(Object.keys(change!.data).sort()).toEqual(["t", "x"]);
    expect(new Set(change!.data.t as string[])).toEqual(
      new Set(["frontdesk", "rooms", "housekeeping"]),
    );
    await settle();
    expect(changes(atB)).toEqual([]);
    expect(changes(atX)).toEqual([]);

    await touchRoom(roomX);
    expect(await atX.waitFor((e) => e.event === "change")).not.toBeNull();
    await settle();
    expect(changes(atA)).toHaveLength(1);
    expect(changes(atB)).toEqual([]);

    // The other property of the same organization: its own stream only.
    await touchRoom(roomB);
    expect(await atB.waitFor((e) => e.event === "change")).not.toBeNull();
    await settle();
    expect(changes(atA)).toHaveLength(1);
    expect(changes(atX)).toHaveLength(1);
    for (const s of [atA, atB, atX]) s.close();
  });

  it("sends nothing for a rolled-back change, and merges one transaction's rows", async () => {
    const stream = await openStream(admin, A);
    await stream.waitLive();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.room.update({ where: { id: roomA }, data: { version: { increment: 1 } } });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await settle();
    expect(changes(stream)).toEqual([]);

    await prisma.$transaction(async (tx) => {
      await tx.room.update({ where: { id: roomA }, data: { version: { increment: 1 } } });
      await tx.room.updateMany({ where: { propertyId: A }, data: { version: { increment: 1 } } });
    });
    await settle();
    expect(changes(stream)).toHaveLength(1);
    stream.close();
  });

  it("announces a business date change to every screen of the property", async () => {
    const stream = await openStream(admin, C);
    await stream.waitLive();
    const ctx: PropertyContext = {
      ...org.adminCtx,
      access: { ...org.adminCtx.access, byProperty: { [C]: ALL_PERMISSIONS } },
      propertyId: C,
      propertyCode: org.properties.C!.code,
      timezone: "Asia/Karachi",
      currencyCode: "PKR",
      businessDate: null,
    };
    await initializeBusinessDate(ctx, {
      date: localDateInZone(new Date(), "Asia/Karachi"),
      reason: "Go live",
    });
    const change = await stream.waitFor((e) => e.event === "change");
    expect(change?.data.t).toEqual(
      expect.arrayContaining(["businessdate", "frontdesk", "rooms", "housekeeping"]),
    );
    stream.close();
  });

  it("reaches every instance: a second listener hears the same change", async () => {
    const second = new RealtimeHub(() => serverEnv().DATABASE_URL);
    const heard: HubEvent[] = [];
    const unsubscribe = second.subscribe((event) => heard.push(event));
    const deadline = Date.now() + 5_000;
    while (!second.live && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    const stream = await openStream(admin, A);
    await stream.waitLive();

    await touchRoom(roomA);
    expect(await stream.waitFor((e) => e.event === "change")).not.toBeNull();
    const until = Date.now() + 5_000;
    while (!heard.some((e) => e.kind === "change" && e.propertyId === A) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(heard.some((e) => e.kind === "change" && e.propertyId === A)).toBe(true);
    unsubscribe();
    await second.stop();
    stream.close();
  });
});

describe("event stream: access changes end it at once", () => {
  it("on sign-out, disabling, a role change and a deactivated property", async () => {
    const make = async (localPart: string) => {
      const user = await createUser(org, localPart, [{ role: "FRONT_DESK_AGENT", property: "A" }]);
      return { user, jar: await loginAs(user.email, TEST_PASSWORD) };
    };

    const signOut = await make("rt-signout");
    const s1 = await openStream(signOut.jar, A);
    await s1.waitLive();
    await call(logoutRoute, { method: "POST", path: "/api/v1/auth/logout", jar: signOut.jar });
    expect(await s1.waitFor((e) => e.event === "reauth")).not.toBeNull();

    const disabled = await make("rt-disabled");
    const s2 = await openStream(disabled.jar, A);
    await s2.waitLive();
    await prisma.user.update({ where: { id: disabled.user.id }, data: { status: "DISABLED" } });
    expect(await s2.waitFor((e) => e.event === "reauth")).not.toBeNull();
    // Reconnecting is refused: the session no longer authenticates.
    expect((await openStream(disabled.jar, A)).response.status).toBe(401);

    const regranted = await make("rt-role");
    const s3 = await openStream(regranted.jar, A);
    await s3.waitLive();
    await prisma.userRoleAssignment.deleteMany({ where: { userId: regranted.user.id } });
    expect(await s3.waitFor((e) => e.event === "reauth")).not.toBeNull();
    expect((await openStream(regranted.jar, A)).response.status).toBe(403);

    const deactivated = await make("rt-property");
    const s4 = await openStream(deactivated.jar, A);
    await s4.waitLive();
    const unrelated = await openStream(admin, B);
    await unrelated.waitLive();
    await prisma.property.update({ where: { id: A }, data: { status: "INACTIVE" } });
    try {
      expect(await s4.waitFor((e) => e.event === "reauth")).not.toBeNull();
      await settle();
      expect(unrelated.received.some((e) => e.event === "reauth")).toBe(false);
    } finally {
      await prisma.property.update({ where: { id: A }, data: { status: "ACTIVE" } });
    }
    for (const s of [s1, s2, s3, s4, unrelated]) s.close();
  }, 60_000);
});
