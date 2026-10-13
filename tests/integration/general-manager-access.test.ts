import { beforeAll, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { GET as dashboardRoute } from "@/app/api/v1/properties/[propertyId]/dashboard/route";
import { GET as summaryRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/summary/route";
import {
  GET as tasksRoute,
  POST as createTaskRoute,
} from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/route";
import { GET as propertiesRoute } from "@/app/api/v1/properties/route";
import { organizationSections } from "@/components/workspace/sections";
import { prisma } from "@/lib/db/prisma";
import type { MeView } from "@/modules/access/access.types";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  buildFixtureInventory,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

/**
 * QA report (account 2 = gm.smr): a General Manager assigned to ONE property
 * next to an Organization Admin (account 1). The demo seed gives gm.smr the
 * GENERAL_MANAGER role at SMR only, and that template excludes
 * `properties:manage` and `roles:manage` (lib/permissions/roles.ts). So the
 * GM's switcher lists one property, More has no Properties, the other
 * property stays closed by URL and API, and housekeeping tasks can be added
 * at the GM's own property (`housekeeping:assign`).
 */

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;
let org: FixtureOrg;
let A: string;
let B: string;
let invA: Inventory;
let invB: Inventory;
let admin: CookieJar; // Organization Admin, organization scope (account 1)
let gm: CookieJar; // General Manager at A only (account 2)
let hkManager: CookieJar; // Housekeeping Manager at A
let housekeeper: CookieJar; // Housekeeper at A: no housekeeping:assign
let agent: CookieJar; // Front Desk Agent at A: no housekeeping:assign

const me = async (jar: CookieJar) =>
  (await call(meRoute, { path: "/api/v1/me", jar })).body.data as MeView;
const at = (propertyId: string, path: string) => `/api/v1/properties/${propertyId}${path}`;
const addTask = (jar: CookieJar, propertyId: string, body: Record<string, unknown>) =>
  call(createTaskRoute, {
    method: "POST",
    path: at(propertyId, "/housekeeping/tasks"),
    params: { propertyId },
    body,
    jar,
  });
const openTaskIds = async (jar: CookieJar, propertyId: string) =>
  (
    await call(tasksRoute, {
      path: at(propertyId, "/housekeeping/tasks?view=open&limit=200"),
      params: { propertyId },
      jar,
    })
  ).body.data.map((t: { id: string }) => t.id);

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  invA = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 6 }]);
  invB = await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }]);
  const users = {
    admin: await createUser(org, "orgadmin", [{ role: "ORGANIZATION_ADMIN" }]),
    gm: await createUser(org, "gm", [{ role: "GENERAL_MANAGER", property: "A" }]),
    hkManager: await createUser(org, "hkm", [{ role: "HOUSEKEEPING_MANAGER", property: "A" }]),
    housekeeper: await createUser(org, "hk", [{ role: "HOUSEKEEPER", property: "A" }]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
  };
  admin = await loginAs(users.admin.email, TEST_PASSWORD);
  gm = await loginAs(users.gm.email, TEST_PASSWORD);
  hkManager = await loginAs(users.hkManager.email, TEST_PASSWORD);
  housekeeper = await loginAs(users.housekeeper.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
}, 180_000);

describe("navigation and property switcher follow the account's grants", () => {
  it("lists exactly the properties each account may access (the switcher's source, /me)", async () => {
    const adminMe = await me(admin);
    expect(adminMe.properties.map((p) => p.id).sort()).toEqual([A, B].sort());
    const gmMe = await me(gm);
    expect(gmMe.properties.map((p) => p.id)).toEqual([A]);
    expect(gmMe.organizationPermissions).toEqual([]);
    // The properties list API agrees with /me.
    const listed = await call(propertiesRoute, { path: "/api/v1/properties", jar: gm });
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((p: { id: string }) => p.id)).toEqual([A]);
  });

  it("gives account 1 Properties under More, and the single-property GM no Properties", async () => {
    const adminSections = organizationSections(await me(admin)).map((s) => s.label);
    expect(adminSections).toEqual([
      "Overview",
      "Reports",
      "Availability",
      "Audit trail",
      "Users & roles",
      "Properties",
    ]);
    const gmMe = await me(gm);
    // The GM template excludes properties:manage; one property is no cross-property view.
    expect(gmMe.properties[0]!.permissions).not.toContain("properties:manage");
    expect(organizationSections(gmMe).map((s) => s.label)).toEqual([
      "Reports",
      "Availability",
      "Audit trail",
      "Users & roles",
    ]);
  });

  it("keeps the other property closed when the GM edits the URL or calls the API", async () => {
    for (const [route, path] of [
      [dashboardRoute, "/dashboard"],
      [summaryRoute, "/housekeeping/summary"],
      [tasksRoute, "/housekeeping/tasks?view=open"],
    ] as const) {
      const r = await call(route, { path: at(B, path), params: { propertyId: B }, jar: gm });
      expect(r.status, path).toBe(403);
    }
    const write = await addTask(gm, B, {
      roomId: invB.roomTypes.KNG!.roomIds[0]!,
      taskTypeId: invB.taskTypes.TURN!,
    });
    expect(write.status).toBe(403);
    // Its own property answers.
    expect(
      (
        await call(dashboardRoute, {
          path: at(A, "/dashboard"),
          params: { propertyId: A },
          jar: gm,
        })
      ).status,
    ).toBe(200);
  });
});

describe("manual housekeeping tasks by role", () => {
  it("lets the single-property General Manager add a task: persisted, audited, listed", async () => {
    const gmMe = await me(gm);
    expect(gmMe.properties[0]!.permissions).toEqual(
      expect.arrayContaining(["housekeeping:assign", "rooms:read"]),
    );
    const roomId = invA.roomTypes.KNG!.roomIds[0]!;
    const r = await addTask(gm, A, {
      roomId,
      taskTypeId: invA.taskTypes.SPEC!,
      description: "Replace the curtains",
      priority: "PRIORITY",
    });
    expect(r.status).toBe(201);
    const task = r.body.data as { id: string };
    expect(await openTaskIds(gm, A)).toContain(task.id);
    expect(
      await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({
      propertyId: A,
      roomId,
      description: "Replace the curtains",
      status: "PENDING",
    });
    const logs = await auditLogsFor(task.id);
    expect(logs.map((l) => l.action)).toContain("housekeeping.task_create");
  });

  it("keeps Organization Admin (any property) and Housekeeping Manager access", async () => {
    const atB = await addTask(admin, B, {
      roomId: invB.roomTypes.KNG!.roomIds[0]!,
      taskTypeId: invB.taskTypes.TURN!,
    });
    expect(atB.status).toBe(201);
    const byManager = await addTask(hkManager, A, {
      roomId: invA.roomTypes.KNG!.roomIds[1]!,
      taskTypeId: invA.taskTypes.TURN!,
    });
    expect(byManager.status).toBe(201);
  });

  it("refuses users without housekeeping:assign, even calling the API directly", async () => {
    const roomId = invA.roomTypes.KNG!.roomIds[2]!;
    for (const jar of [housekeeper, agent]) {
      const r = await addTask(jar, A, { roomId, taskTypeId: invA.taskTypes.TURN! });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN");
    }
    expect(await prisma.housekeepingTask.count({ where: { roomId } })).toBe(0);
  });
});
