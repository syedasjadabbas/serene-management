import { beforeAll, describe, expect, it } from "vitest";
import { GET as availabilityRoute } from "@/app/api/v1/properties/[propertyId]/availability/route";
import { POST as checkOutRoute } from "@/app/api/v1/properties/[propertyId]/stays/[stayId]/check-out/route";
import { POST as assignTaskRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/[taskId]/assign/route";
import { POST as cancelTaskRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/[taskId]/cancel/route";
import { POST as completeTaskRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/[taskId]/complete/route";
import { GET as taskRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/[taskId]/route";
import { POST as startTaskRoute } from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/[taskId]/start/route";
import {
  GET as tasksRoute,
  POST as createTaskRoute,
} from "@/app/api/v1/properties/[propertyId]/housekeeping/tasks/route";
import { POST as assignRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/assign/route";
import { POST as cancelRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/cancel/route";
import { POST as closeRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/close/route";
import { POST as holdRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/hold/route";
import { POST as resolveRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/resolve/route";
import { POST as resumeRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/resume/route";
import { GET as requestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/route";
import { POST as startRequestRoute } from "@/app/api/v1/properties/[propertyId]/maintenance/[requestId]/start/route";
import {
  GET as requestsRoute,
  POST as createRequestRoute,
} from "@/app/api/v1/properties/[propertyId]/maintenance/route";
import { POST as releaseRoute } from "@/app/api/v1/properties/[propertyId]/room-blocks/[blockId]/release/route";
import { POST as assignRoomRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/assign-room/route";
import { POST as checkInRoute } from "@/app/api/v1/properties/[propertyId]/reservation-rooms/[reservationRoomId]/check-in/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { POST as blocksRoute } from "@/app/api/v1/properties/[propertyId]/rooms/[roomId]/blocks/route";
import { POST as inspectRoute } from "@/app/api/v1/properties/[propertyId]/rooms/[roomId]/inspect/route";
import { POST as markCleanRoute } from "@/app/api/v1/properties/[propertyId]/rooms/[roomId]/mark-clean/route";
import { POST as markDirtyRoute } from "@/app/api/v1/properties/[propertyId]/rooms/[roomId]/mark-dirty/route";
import { GET as boardRoute } from "@/app/api/v1/properties/[propertyId]/rooms/board/route";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDateOnly } from "@/modules/business-date/business-date.policy";
import { stayNights } from "@/modules/reservations/reservations.policy";
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

let org: FixtureOrg;
let A: string;
let B: string;
let invA: Inventory;
let D: string;
let guestId: string;
let fom: CookieJar; // front office manager @ A
let agent: CookieJar; // front desk agent @ A
let sup: CookieJar; // housekeeping manager @ A (assign, inspect, out of order)
let hk: CookieJar; // housekeeper @ A
let hk2: CookieJar; // second housekeeper @ A
let tech: CookieJar; // maintenance staff @ A
let chief: CookieJar; // maintenance manager @ A
let gmB: CookieJar; // general manager @ B only
let hkUserId: string;
let techUserId: string;

const pool: Record<string, string[]> = {};
function takeRoom(type: "KNG" | "TWN" | "SGL"): string {
  const room = pool[type]!.shift();
  if (!room) throw new Error(`Fixture ran out of ${type} rooms`);
  return room;
}

const base = (propertyId = A) => `/api/v1/properties/${propertyId}`;

function post(
  route: typeof createTaskRoute,
  jar: CookieJar,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
  propertyId = A,
) {
  return call(route, {
    method: "POST",
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    body,
    jar,
  });
}

function get(route: typeof tasksRoute, jar: CookieJar, path: string, params = {}, propertyId = A) {
  return call(route, {
    path: `${base(propertyId)}${path}`,
    params: { propertyId, ...params },
    jar,
  });
}

const taskCmd =
  (route: typeof startTaskRoute, action: string) =>
  (jar: CookieJar, taskId: string, body: Record<string, unknown>, propertyId = A) =>
    post(route, jar, `/housekeeping/tasks/${taskId}/${action}`, { taskId }, body, propertyId);
const assignTask = taskCmd(assignTaskRoute, "assign");
const startTask = taskCmd(startTaskRoute, "start");
const completeTask = taskCmd(completeTaskRoute, "complete");
const cancelTask = taskCmd(cancelTaskRoute, "cancel");

const reqCmd =
  (route: typeof startRequestRoute, action: string) =>
  (jar: CookieJar, requestId: string, body: Record<string, unknown>, propertyId = A) =>
    post(route, jar, `/maintenance/${requestId}/${action}`, { requestId }, body, propertyId);

const roomCmd =
  (route: typeof inspectRoute, action: string) =>
  (jar: CookieJar, roomId: string, body: Record<string, unknown>, propertyId = A) =>
    post(route, jar, `/rooms/${roomId}/${action}`, { roomId }, body, propertyId);
const inspect = roomCmd(inspectRoute, "inspect");
const markClean = roomCmd(markCleanRoute, "mark-clean");
const markDirty = roomCmd(markDirtyRoute, "mark-dirty");
const placeBlock = roomCmd(blocksRoute, "blocks");

async function roomRow(roomId: string) {
  return prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: {
      housekeepingStatus: true,
      frontOfficeStatus: true,
      serviceStatus: true,
      version: true,
    },
  });
}

async function setRoom(roomId: string, housekeepingStatus: "CLEAN" | "DIRTY" | "INSPECTED") {
  await prisma.room.update({ where: { id: roomId }, data: { housekeepingStatus } });
}

async function book(overrides: Record<string, unknown> = {}) {
  const r = await post(
    createReservationRoute,
    fom,
    "/reservations",
    {},
    {
      arrival: D,
      departure: addDays(D, 2),
      adults: 1,
      roomTypeId: invA.roomTypes.KNG!.id,
      ratePlanId: invA.ratePlans.BAR!,
      reservationTypeId: invA.reservationTypes.GTD!,
      guestId,
      ...overrides,
    },
  );
  if (r.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(r.body)}`);
  return r.body.data.rooms[0] as { id: string; version: number };
}

function checkIn(jar: CookieJar, rrId: string, body: Record<string, unknown>) {
  return post(
    checkInRoute,
    jar,
    `/reservation-rooms/${rrId}/check-in`,
    { reservationRoomId: rrId },
    body,
  );
}

/** A guest checked in yesterday, departing today (fixture history, like the demo seed). */
async function dueOutGuest(roomId: string) {
  const rr = await book({ roomId, departure: addDays(D, 1) });
  const r = await checkIn(agent, rr.id, { version: rr.version });
  if (r.status !== 201) throw new Error(`Check-in failed: ${JSON.stringify(r.body)}`);
  const arrival = addDays(D, -1);
  const night = await prisma.reservationRoomNight.findFirstOrThrow({
    where: { reservationRoomId: rr.id },
    select: { roomTypeId: true, ratePlanId: true, rateAmount: true, currencyCode: true },
  });
  await prisma.$transaction([
    prisma.reservationRoomNight.deleteMany({ where: { reservationRoomId: rr.id } }),
    prisma.reservationRoomNight.createMany({
      data: stayNights(arrival, D).map((d) => ({
        propertyId: A,
        reservationRoomId: rr.id,
        stayDate: fromDateOnly(d),
        ...night,
        adults: 1,
        children: 0,
        // Nights before today were posted by earlier night audits.
        postedAt: new Date(),
      })),
    }),
    prisma.reservationRoom.update({
      where: { id: rr.id },
      data: { arrivalDate: fromDateOnly(arrival), departureDate: fromDateOnly(D) },
    }),
    prisma.roomAssignment.updateMany({
      where: { reservationRoomId: rr.id, status: "ACTIVE" },
      data: { fromDate: fromDateOnly(arrival), toDate: fromDateOnly(D) },
    }),
    prisma.stay.updateMany({
      where: { reservationRoomId: rr.id },
      data: { arrivalBusinessDate: fromDateOnly(arrival) },
    }),
  ]);
  return { reservationRoomId: rr.id, stay: r.body.data as { id: string; version: number } };
}

async function createTask(roomId: string, overrides: Record<string, unknown> = {}) {
  const r = await post(
    createTaskRoute,
    sup,
    "/housekeeping/tasks",
    {},
    {
      roomId,
      taskTypeId: invA.taskTypes.DEP!,
      ...overrides,
    },
  );
  if (r.status !== 201) throw new Error(`Task failed: ${JSON.stringify(r.body)}`);
  return r.body.data as { id: string; version: number; status: string };
}

async function freshTask(taskId: string) {
  return prisma.housekeepingTask.findUniqueOrThrow({ where: { id: taskId } });
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
  invA = await buildFixtureInventory(org, "A", [
    { code: "KNG", rooms: 50 },
    { code: "TWN", rooms: 2 },
    { code: "SGL", rooms: 1, maxOccupancy: 1 },
  ]);
  await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }]);
  D = invA.businessDate;
  // Property A only accepts inspected rooms: cleaning alone never makes a room ready.
  await prisma.propertyConfiguration.upsert({
    where: { propertyId: A },
    update: { requireInspectedForCheckIn: true },
    create: { propertyId: A, requireInspectedForCheckIn: true },
  });
  await prisma.room.updateMany({
    where: { propertyId: { in: [A, B] } },
    data: { housekeepingStatus: "INSPECTED", frontOfficeStatus: "VACANT" },
  });
  for (const type of ["KNG", "TWN", "SGL"] as const)
    pool[type] = [...invA.roomTypes[type]!.roomIds];
  guestId = (await createGuestRow(org, "Omar", "Farouk")).id;

  const users = {
    fom: await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    sup: await createUser(org, "sup", [{ role: "HOUSEKEEPING_MANAGER", property: "A" }]),
    hk: await createUser(org, "hk", [{ role: "HOUSEKEEPER", property: "A" }]),
    hk2: await createUser(org, "hk2", [{ role: "HOUSEKEEPER", property: "A" }]),
    tech: await createUser(org, "tech", [{ role: "MAINTENANCE_STAFF", property: "A" }]),
    chief: await createUser(org, "chief", [{ role: "MAINTENANCE_MANAGER", property: "A" }]),
    gmB: await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]),
  };
  hkUserId = users.hk.id;
  techUserId = users.tech.id;
  fom = await loginAs(users.fom.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
  sup = await loginAs(users.sup.email, TEST_PASSWORD);
  hk = await loginAs(users.hk.email, TEST_PASSWORD);
  hk2 = await loginAs(users.hk2.email, TEST_PASSWORD);
  tech = await loginAs(users.tech.email, TEST_PASSWORD);
  chief = await loginAs(users.chief.email, TEST_PASSWORD);
  gmB = await loginAs(users.gmB.email, TEST_PASSWORD);
}, 180_000);

describe("check-out → housekeeping", () => {
  it("queues the departure clean in the check-out transaction, urgent when a guest arrives", async () => {
    const roomId = takeRoom("KNG");
    const leaving = await dueOutGuest(roomId);
    // The next guest is assigned the same room from today.
    await book({ roomId });
    const r = await post(
      checkOutRoute,
      agent,
      `/stays/${leaving.stay.id}/check-out`,
      { stayId: leaving.stay.id },
      { version: leaving.stay.version },
    );
    expect(r.status).toBe(200);
    expect(await roomRow(roomId)).toMatchObject({
      housekeepingStatus: "DIRTY",
      frontOfficeStatus: "VACANT",
    });
    const tasks = await prisma.housekeepingTask.findMany({ where: { roomId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: "PENDING",
      stayId: leaving.stay.id,
      priority: 10,
      taskTypeId: invA.taskTypes.DEP,
    });
    const audit = (await auditLogsFor(leaving.stay.id)).find((a) => a.action === "stay.check_out");
    expect(audit!.after).toMatchObject({
      cleaningTaskId: tasks[0]!.id,
      cleaningPriority: "URGENT",
    });
  });
});

describe("housekeeping tasks", () => {
  it("runs assign → start → complete → inspect and only then makes the room ready", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const task = await createTask(roomId);
    const assigned = await assignTask(sup, task.id, {
      version: task.version,
      assigneeId: hkUserId,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data).toMatchObject({
      status: "PENDING",
      attendant: { userId: hkUserId },
    });

    const started = await startTask(hk, task.id, { version: assigned.body.data.version });
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe("IN_PROGRESS");
    const done = await completeTask(hk, task.id, { version: started.body.data.version });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      status: "COMPLETED",
      awaitingInspection: true,
      room: { housekeepingStatus: "CLEAN", readiness: "NOT_INSPECTED" },
    });
    const row = await freshTask(task.id);
    expect(row.completedById).toBe(hkUserId);
    expect(row.completedAt).not.toBeNull();

    // Cleaned but not inspected: the front desk cannot put a guest in.
    const arriving = await book();
    const blocked = await checkIn(agent, arriving.id, { version: arriving.version, roomId });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details).toMatchObject({
      reason: "ROOM_NOT_READY",
      readiness: "NOT_INSPECTED",
    });

    const room = await roomRow(roomId);
    const passed = await inspect(sup, roomId, { version: room.version, outcome: "PASS" });
    expect(passed.status).toBe(200);
    expect(await roomRow(roomId)).toMatchObject({ housekeepingStatus: "INSPECTED" });
    const inspected = await freshTask(task.id);
    expect(inspected.status).toBe("INSPECTED");
    expect(inspected.inspectedById).not.toBeNull();

    const history = await prisma.roomStatusHistory.findMany({
      where: { roomId, source: "HOUSEKEEPING" },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => `${h.fromValue}→${h.toValue}`)).toEqual([
      "DIRTY→CLEAN",
      "CLEAN→INSPECTED",
    ]);
    const audits = (await auditLogsFor(task.id)).map((a) => a.action);
    expect(audits).toEqual(
      expect.arrayContaining([
        "housekeeping.task_create",
        "housekeeping.task_assign",
        "housekeeping.task_start",
        "housekeeping.task_complete",
      ]),
    );
    expect((await auditLogsFor(roomId)).map((a) => a.action)).toContain(
      "housekeeping.room_inspect_pass",
    );

    // Inspected and vacant: now the guest can check in.
    const ok = await checkIn(agent, arriving.id, { version: arriving.version, roomId });
    expect(ok.status).toBe(201);
  });

  it("rejects invalid transitions and illegal actors", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const task = await createTask(roomId, { assigneeId: hkUserId });
    expect((await completeTask(hk, task.id, { version: task.version })).status).toBe(422);
    // Another housekeeper cannot work someone else's task; a housekeeper cannot assign.
    const other = await startTask(hk2, task.id, { version: task.version });
    expect(other.status).toBe(403);
    expect(other.body.error.details.reason).toBe("NOT_TASK_OWNER");
    expect(
      (await assignTask(hk, task.id, { version: task.version, assigneeId: null })).status,
    ).toBe(403);
    // The front desk has no housekeeping permissions.
    expect((await startTask(agent, task.id, { version: task.version })).status).toBe(403);
    // Assignees must be housekeeping users of the property.
    const bad = await assignTask(sup, task.id, { version: task.version, assigneeId: techUserId });
    expect(bad.status).toBe(400);
    // Duplicate live task of the same type today.
    const dup = await post(
      createTaskRoute,
      sup,
      "/housekeeping/tasks",
      {},
      {
        roomId,
        taskTypeId: invA.taskTypes.DEP!,
      },
    );
    expect(dup.status).toBe(409);
    expect(await freshTask(task.id)).toMatchObject({ status: "PENDING", version: task.version });
  });

  it("lets a housekeeper pick up an unassigned task", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const task = await createTask(roomId);
    const r = await startTask(hk2, task.id, { version: task.version });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "IN_PROGRESS", mine: true });
    const mine = await get(tasksRoute, hk2, "/housekeeping/tasks?view=mine");
    expect(mine.body.data.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it("serializes concurrent assignment and concurrent completion", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const task = await createTask(roomId);
    const assigns = await Promise.all([
      assignTask(sup, task.id, { version: task.version, assigneeId: hkUserId }),
      assignTask(sup, task.id, { version: task.version, assigneeId: null }),
    ]);
    // The second (unassign → no change / stale) never overwrites the winner silently.
    expect(assigns.filter((r) => r.status === 200)).toHaveLength(1);
    const current = await freshTask(task.id);
    const started = await startTask(sup, task.id, { version: current.version });
    const both = await Promise.all([
      completeTask(sup, task.id, { version: started.body.data.version }),
      completeTask(sup, task.id, { version: started.body.data.version }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.roomStatusHistory.count({ where: { roomId, source: "HOUSEKEEPING" } }),
    ).toBe(1);
  });

  it("keeps a task consistent when an attendant completes while a supervisor cancels", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const task = await createTask(roomId, { assigneeId: hkUserId });
    const started = await startTask(hk, task.id, { version: task.version });
    const v = started.body.data.version;
    const [done, cancelled] = await Promise.all([
      completeTask(hk, task.id, { version: v }),
      cancelTask(sup, task.id, { version: v, reason: "Room out of use" }),
    ]);
    // Cancel is illegal for a task in progress; completion wins, state stays coherent.
    expect(done.status).toBe(200);
    expect([409, 422]).toContain(cancelled.status);
    expect(await freshTask(task.id)).toMatchObject({ status: "COMPLETED" });
    expect(await roomRow(roomId)).toMatchObject({ housekeepingStatus: "CLEAN" });
  });

  it("fails an inspection back to the attendant", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const task = await createTask(roomId, { assigneeId: hkUserId });
    const s = await startTask(hk, task.id, { version: task.version });
    await completeTask(hk, task.id, { version: s.body.data.version });
    const room = await roomRow(roomId);
    expect((await inspect(hk, roomId, { version: room.version, outcome: "PASS" })).status).toBe(
      403,
    );
    expect((await inspect(sup, roomId, { version: room.version, outcome: "FAIL" })).status).toBe(
      400,
    ); // a failure needs notes
    const failed = await inspect(sup, roomId, {
      version: room.version,
      outcome: "FAIL",
      notes: "Bathroom not done",
    });
    expect(failed.status).toBe(200);
    expect(await roomRow(roomId)).toMatchObject({ housekeepingStatus: "DIRTY" });
    const row = await freshTask(task.id);
    expect(row.status).toBe("FAILED_INSPECTION");
    // Inspecting a dirty room is illegal; the attendant redoes the task.
    expect(
      (await inspect(sup, roomId, { version: room.version + 1, outcome: "PASS" })).status,
    ).toBe(422);
    const again = await startTask(hk, task.id, { version: row.version });
    expect(again.status).toBe(200);
  });

  it("serializes two concurrent mark-clean corrections", async () => {
    const roomId = takeRoom("KNG");
    await setRoom(roomId, "DIRTY");
    const { version } = await roomRow(roomId);
    const results = await Promise.all([
      markClean(sup, roomId, { version }),
      markClean(sup, roomId, { version }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await markClean(hk, roomId, { version: version + 1 })).status).toBe(403);
    const dirty = await markDirty(hk, roomId, { version: version + 1, notes: "Used by staff" });
    expect(dirty.status).toBe(200);
    const history = await prisma.roomStatusHistory.findFirstOrThrow({
      where: { roomId, toValue: "DIRTY", source: "HOUSEKEEPING" },
    });
    expect(history.reason).toBe("Used by staff");
  });

  it("isolates housekeeping per property", async () => {
    const roomId = takeRoom("KNG");
    const task = await createTask(roomId);
    expect((await startTask(gmB, task.id, { version: task.version })).status).toBe(403);
    expect((await startTask(gmB, task.id, { version: task.version }, B)).status).toBe(404);
    expect(
      (await get(taskRoute, gmB, `/housekeeping/tasks/${task.id}`, { taskId: task.id }, B)).status,
    ).toBe(404);
    const list = await get(tasksRoute, gmB, "/housekeeping/tasks?view=all", {}, B);
    expect(list.body.data.map((t: { id: string }) => t.id)).not.toContain(task.id);
    expect((await markDirty(gmB, roomId, { version: 1 }, B)).status).toBe(404);
  });
});

describe("out of order / out of service", () => {
  const reason = "Pipe burst in bathroom";

  it("removes an out-of-order room from inventory, assignment and check-in", async () => {
    const roomId = takeRoom("KNG");
    const avail = async () => {
      const r = await call(availabilityRoute, {
        path: `${base()}/availability?arrival=${addDays(D, 3)}&departure=${addDays(D, 4)}&adults=1`,
        params: { propertyId: A },
        jar: fom,
      });
      return r.body.data.roomTypes.find(
        (t: { roomType: { code: string } }) => t.roomType.code === "KNG",
      ).available as number;
    };
    const before = await avail();
    const placed = await placeBlock(sup, roomId, {
      kind: "OUT_OF_ORDER",
      to: addDays(D, 5),
      reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
      reason,
    });
    expect(placed.status).toBe(201);
    expect(placed.body.data).toMatchObject({
      readiness: "OUT_OF_ORDER",
      serviceStatus: "OUT_OF_ORDER",
    });
    expect(await avail()).toBe(before - 1);
    const counter = await prisma.roomTypeInventory.findFirstOrThrow({
      where: { roomTypeId: invA.roomTypes.KNG!.id, stayDate: fromDateOnly(addDays(D, 3)) },
    });
    expect(counter.outOfOrder).toBeGreaterThanOrEqual(1);
    const [audit] = (await auditLogsFor(roomId)).filter((a) => a.action === "room.out_of_order");
    expect(audit).toMatchObject({ risk: "HIGH", reason });

    const rr = await book();
    const ci = await checkIn(agent, rr.id, { version: rr.version, roomId });
    expect(ci.status).toBe(422);
    expect(ci.body.error.details.reason).toBe("ROOM_OUT_OF_ORDER");
    const assign = await post(
      assignRoomRoute,
      agent,
      `/reservation-rooms/${rr.id}/assign-room`,
      { reservationRoomId: rr.id },
      { version: rr.version, roomId },
    );
    expect(assign.status).toBe(422);
    // Front desk agents cannot place blocks (rooms:out_of_order).
    expect(
      (
        await placeBlock(agent, takeRoom("KNG"), {
          kind: "OUT_OF_ORDER",
          to: addDays(D, 2),
          reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
          reason,
        })
      ).status,
    ).toBe(403);
  });

  it("refuses to block a room that is assigned, occupied or the last one to sell", async () => {
    const assignedRoom = takeRoom("KNG");
    await book({ roomId: assignedRoom, arrival: addDays(D, 1), departure: addDays(D, 3) });
    const assigned = await placeBlock(sup, assignedRoom, {
      kind: "OUT_OF_ORDER",
      to: addDays(D, 4),
      reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
      reason,
    });
    expect(assigned.status).toBe(409);
    expect(assigned.body.error.details.reason).toBe("ROOM_ASSIGNED");

    const sgl = takeRoom("SGL");
    await book({
      roomTypeId: invA.roomTypes.SGL!.id,
      arrival: addDays(D, 10),
      departure: addDays(D, 11),
    });
    const oversell = await placeBlock(sup, sgl, {
      kind: "OUT_OF_ORDER",
      from: addDays(D, 10),
      to: addDays(D, 12),
      reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
      reason,
    });
    expect(oversell.status).toBe(422);
    expect(oversell.body.error.details.reason).toBe("BLOCK_OVERSELLS");
    expect(await prisma.roomServiceBlock.count({ where: { roomId: sgl } })).toBe(0);
  });

  it("returns a room to service dirty, with a priority cleaning task; a second release conflicts", async () => {
    const roomId = takeRoom("KNG");
    const placed = await placeBlock(sup, roomId, {
      kind: "OUT_OF_ORDER",
      to: addDays(D, 3),
      reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
      reason,
    });
    const blockId = placed.body.data.blocks[0].id;
    const release = (jar: CookieJar) =>
      post(releaseRoute, jar, `/room-blocks/${blockId}/release`, { blockId }, { reason: "Fixed" });
    const results = await Promise.all([release(sup), release(sup)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await roomRow(roomId)).toMatchObject({
      serviceStatus: "IN_SERVICE",
      housekeepingStatus: "DIRTY",
    });
    const tasks = await prisma.housekeepingTask.findMany({ where: { roomId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "PENDING", priority: 50 });
    const ok = results.find((r) => r.status === 200)!;
    expect(ok.body.data.readiness).toBe("DIRTY");
  });

  it("keeps an out-of-service room sellable but blocks check-in without an override", async () => {
    const roomId = takeRoom("KNG");
    const placed = await placeBlock(sup, roomId, {
      kind: "OUT_OF_SERVICE",
      to: addDays(D, 2),
      reasonCodeId: invA.reasonCodes["OUT_OF_SERVICE:TOUCH"]!,
      reason: "Paint touch-up",
    });
    expect(placed.status).toBe(201);
    expect(placed.body.data.readiness).toBe("OUT_OF_SERVICE");
    const rr = await book();
    const ci = await checkIn(agent, rr.id, { version: rr.version, roomId });
    expect(ci.status).toBe(422);
    expect(ci.body.error.details).toMatchObject({
      reason: "ROOM_NOT_READY",
      readiness: "OUT_OF_SERVICE",
    });
  });

  it("stays consistent when a block and a room assignment race for the same room", async () => {
    // Repeated: before rooms were locked for assignment this race could let both win.
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomId = takeRoom("KNG");
      const rr = await book({ arrival: addDays(D, 1), departure: addDays(D, 2) });
      const [block, assign] = await Promise.all([
        placeBlock(sup, roomId, {
          kind: "OUT_OF_ORDER",
          from: addDays(D, 1),
          to: addDays(D, 3),
          reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
          reason,
        }),
        post(
          assignRoomRoute,
          agent,
          `/reservation-rooms/${rr.id}/assign-room`,
          { reservationRoomId: rr.id },
          { version: rr.version, roomId },
        ),
      ]);
      const blocked = block.status === 201;
      const assigned = assign.status === 200;
      expect(blocked !== assigned).toBe(true); // exactly one wins
      const liveBlocks = await prisma.roomServiceBlock.count({
        where: { roomId, status: { in: ["SCHEDULED", "ACTIVE"] } },
      });
      const activeAssignments = await prisma.roomAssignment.count({
        where: { roomId, status: "ACTIVE" },
      });
      expect(liveBlocks + activeAssignments).toBe(1);
    }
  });
});

describe("maintenance", () => {
  async function report(jar: CookieJar, body: Record<string, unknown>) {
    return post(
      createRequestRoute,
      jar,
      "/maintenance",
      {},
      {
        categoryId: invA.maintenanceCategories.PLUMB!,
        title: "Leaking shower",
        priority: "HIGH",
        ...body,
      },
    );
  }

  it("runs open → assigned → in progress → on hold → resolved → closed with activities", async () => {
    const roomId = takeRoom("KNG");
    const created = await report(hk, { roomId });
    expect(created.status).toBe(201);
    const request = created.body.data;
    expect(request).toMatchObject({ status: "OPEN", priority: "HIGH" });
    expect(request.requestNumber).toMatch(/^M\d{4,}$/);

    const assigned = await reqCmd(assignRequestRoute, "assign")(chief, request.id, {
      version: request.version,
      assigneeId: techUserId,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data).toMatchObject({ status: "ASSIGNED", assignee: { id: techUserId } });
    const started = await reqCmd(startRequestRoute, "start")(tech, request.id, {
      version: assigned.body.data.version,
    });
    expect(started.body.data.status).toBe("IN_PROGRESS");
    const held = await reqCmd(holdRequestRoute, "hold")(tech, request.id, {
      version: started.body.data.version,
      note: "Waiting for parts",
    });
    expect(held.body.data.status).toBe("ON_HOLD");
    const resumed = await reqCmd(resumeRequestRoute, "resume")(tech, request.id, {
      version: held.body.data.version,
    });
    const resolved = await reqCmd(resolveRequestRoute, "resolve")(tech, request.id, {
      version: resumed.body.data.version,
      resolution: "Replaced cartridge",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({
      status: "RESOLVED",
      resolution: "Replaced cartridge",
    });
    // A room that was never blocked keeps its housekeeping status.
    expect(await roomRow(roomId)).toMatchObject({ housekeepingStatus: "INSPECTED" });
    const closed = await reqCmd(closeRequestRoute, "close")(chief, request.id, {
      version: resolved.body.data.version,
    });
    expect(closed.body.data.status).toBe("CLOSED");
    const activities = await prisma.maintenanceActivity.findMany({
      where: { requestId: request.id },
    });
    expect(activities.map((a) => a.toStatus).filter(Boolean)).toEqual(
      expect.arrayContaining(["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"]),
    );
    const audits = (await auditLogsFor(request.id)).map((a) => a.action);
    expect(audits).toEqual(
      expect.arrayContaining(["maintenance.create", "maintenance.assign", "maintenance.resolve"]),
    );
  });

  it("rejects invalid transitions and illegal actors", async () => {
    const created = await report(chief, { location: "Lobby toilets", priority: "LOW" });
    const request = created.body.data;
    expect(
      (await reqCmd(closeRequestRoute, "close")(chief, request.id, { version: request.version }))
        .status,
    ).toBe(422);
    const assigned = await reqCmd(assignRequestRoute, "assign")(chief, request.id, {
      version: request.version,
      assigneeId: techUserId,
    });
    // Housekeepers may report but not work or read maintenance.
    expect(
      (
        await reqCmd(startRequestRoute, "start")(hk, request.id, {
          version: assigned.body.data.version,
        })
      ).status,
    ).toBe(403);
    expect((await get(requestsRoute, hk, "/maintenance")).status).toBe(403);
    // The front desk may report maintenance but not work it (no maintenance:update).
    const fromDesk = await report(agent, { location: "Lobby" });
    expect(fromDesk.status).toBe(201);
    expect(
      (
        await reqCmd(startRequestRoute, "start")(agent, fromDesk.body.data.id, {
          version: fromDesk.body.data.version,
        })
      ).status,
    ).toBe(403);
    // Only managers assign.
    expect(
      (
        await reqCmd(assignRequestRoute, "assign")(tech, request.id, {
          version: assigned.body.data.version,
          assigneeId: techUserId,
        })
      ).status,
    ).toBe(403);
  });

  it("blocks the room while the work is open and returns it dirty, never ready", async () => {
    const roomId = takeRoom("KNG");
    const created = await report(chief, {
      roomId,
      priority: "URGENT",
      blockRoom: {
        kind: "OUT_OF_ORDER",
        to: addDays(D, 3),
        reasonCodeId: invA.reasonCodes["OUT_OF_ORDER:MAINT"]!,
      },
      reason: "No water in room",
    });
    expect(created.status).toBe(201);
    const request = created.body.data;
    expect(request.roomBlocked).toBe("OUT_OF_ORDER");
    expect(await roomRow(roomId)).toMatchObject({ serviceStatus: "OUT_OF_ORDER" });

    // The front desk cannot use the room.
    const rr = await book();
    const ci = await checkIn(agent, rr.id, { version: rr.version, roomId });
    expect(ci.body.error.details.reason).toBe("ROOM_OUT_OF_ORDER");
    // Cancelling while the room is blocked is refused.
    const cancel = await reqCmd(cancelRequestRoute, "cancel")(chief, request.id, {
      version: request.version,
      reason: "Duplicate",
    });
    expect(cancel.status).toBe(422);

    const started = await reqCmd(startRequestRoute, "start")(chief, request.id, {
      version: request.version,
    });
    const resolved = await reqCmd(resolveRequestRoute, "resolve")(chief, request.id, {
      version: started.body.data.version,
      resolution: "Valve replaced",
      returnToService: true,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.roomBlocked).toBeNull();
    // Back in service but dirty with a priority cleaning task: not ready yet.
    expect(await roomRow(roomId)).toMatchObject({
      serviceStatus: "IN_SERVICE",
      housekeepingStatus: "DIRTY",
    });
    const tasks = await prisma.housekeepingTask.findMany({ where: { roomId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe(50);
    const again = await checkIn(agent, rr.id, { version: rr.version, roomId });
    expect(again.body.error.details).toMatchObject({
      reason: "ROOM_NOT_READY",
      readiness: "DIRTY",
    });
    const [audit] = (await auditLogsFor(request.id)).filter(
      (a) => a.action === "maintenance.resolve",
    );
    expect(audit!.risk).toBe("HIGH");
  });

  it("isolates maintenance per property", async () => {
    const created = await report(chief, { location: "Spa" });
    const id = created.body.data.id;
    expect((await get(requestRoute, gmB, `/maintenance/${id}`, { requestId: id }, B)).status).toBe(
      404,
    );
    expect((await get(requestRoute, gmB, `/maintenance/${id}`, { requestId: id })).status).toBe(
      403,
    );
    const list = await get(requestsRoute, gmB, "/maintenance?view=all", {}, B);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(id);
  });
});

describe("room board", () => {
  it("shows housekeeping, service and maintenance state, and hides guests without frontdesk:read", async () => {
    const roomId = takeRoom("KNG");
    await dueOutGuest(roomId);
    const board = await get(boardRoute, sup, "/rooms/board?filter=departing");
    expect(board.status).toBe(200);
    const row = board.body.data.items.find((r: { id: string }) => r.id === roomId);
    expect(row).toMatchObject({ frontOfficeStatus: "OCCUPIED", inHouse: { departingToday: true } });
    expect(row.inHouse.guestName).not.toBeNull(); // housekeeping managers have frontdesk:read

    const hkBoard = await get(boardRoute, hk, "/rooms/board?filter=departing");
    const hkRow = hkBoard.body.data.items.find((r: { id: string }) => r.id === roomId);
    expect(hkRow.inHouse).toMatchObject({ guestName: null, stayId: null, departingToday: true });
    expect(hkBoard.body.data.counts.total).toBeGreaterThan(0);
    expect((await get(boardRoute, gmB, "/rooms/board")).status).toBe(403);
  });
});
