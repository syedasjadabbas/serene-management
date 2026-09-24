import { describe, expect, it } from "vitest";
import {
  PRIORITY_VALUES,
  cleaningPriority,
  needsInspection,
  priorityLabel,
  taskActorProblem,
  taskTransition,
} from "@/modules/housekeeping/housekeeping.policy";
import { inspectRoomSchema } from "@/modules/housekeeping/housekeeping.schema";
import {
  maintenanceActorProblem,
  maintenanceTransition,
} from "@/modules/maintenance/maintenance.policy";
import { createRequestSchema } from "@/modules/maintenance/maintenance.schema";
import {
  housekeepingTransition,
  isOverridableReadiness,
  roomBoardStatus,
  roomReadiness,
} from "@/modules/rooms/rooms.policy";
import { placeBlockSchema } from "@/modules/rooms/rooms.schema";

const ID = "01900000-0000-7000-8000-000000000001";
const room = (overrides: Partial<Parameters<typeof roomReadiness>[0]> = {}) => ({
  housekeepingStatus: "CLEAN" as const,
  frontOfficeStatus: "VACANT" as const,
  outOfOrder: false,
  outOfService: false,
  ...overrides,
});

describe("room readiness with service status", () => {
  it("keeps occupancy, housekeeping and service as separate axes", () => {
    expect(roomReadiness(room({ outOfService: true }), false)).toBe("OUT_OF_SERVICE");
    expect(roomReadiness(room({ outOfOrder: true, outOfService: true }), false)).toBe(
      "OUT_OF_ORDER",
    );
    expect(roomReadiness(room({ frontOfficeStatus: "OCCUPIED", outOfService: true }), false)).toBe(
      "OCCUPIED",
    );
    expect(roomReadiness(room({ housekeepingStatus: "DIRTY", outOfService: true }), false)).toBe(
      "OUT_OF_SERVICE",
    );
  });

  it("requires inspection when the property demands it", () => {
    expect(roomReadiness(room(), true)).toBe("NOT_INSPECTED");
    expect(roomReadiness(room({ housekeepingStatus: "INSPECTED" }), true)).toBe("READY");
  });

  it("lets an authorized override accept out of service, never out of order", () => {
    expect(isOverridableReadiness("OUT_OF_SERVICE")).toBe(true);
    expect(isOverridableReadiness("OUT_OF_ORDER")).toBe(false);
    expect(roomBoardStatus(room({ outOfService: true }), false)).toBe("OUT_OF_SERVICE");
  });
});

describe("housekeeping status transitions (server-decided)", () => {
  it("allows only legal room transitions", () => {
    expect(housekeepingTransition("mark_clean", "DIRTY")).toEqual({ next: "CLEAN" });
    expect(housekeepingTransition("mark_clean", "PICKUP")).toEqual({ next: "CLEAN" });
    expect(housekeepingTransition("mark_clean", "INSPECTED")).toHaveProperty("problem");
    expect(housekeepingTransition("mark_dirty", "INSPECTED")).toEqual({ next: "DIRTY" });
    expect(housekeepingTransition("mark_dirty", "DIRTY")).toHaveProperty("problem");
    expect(housekeepingTransition("inspect_pass", "CLEAN")).toEqual({ next: "INSPECTED" });
    expect(housekeepingTransition("inspect_pass", "DIRTY")).toHaveProperty("problem");
    expect(housekeepingTransition("inspect_fail", "CLEAN")).toEqual({ next: "DIRTY" });
    expect(housekeepingTransition("inspect_fail", "DIRTY")).toHaveProperty("problem");
  });
});

describe("housekeeping task state machine", () => {
  it("follows pending → in progress → completed", () => {
    expect(taskTransition("start", "PENDING")).toEqual({ next: "IN_PROGRESS" });
    expect(taskTransition("pause", "IN_PROGRESS")).toEqual({ next: "PAUSED" });
    expect(taskTransition("start", "PAUSED")).toEqual({ next: "IN_PROGRESS" });
    expect(taskTransition("complete", "IN_PROGRESS")).toEqual({ next: "COMPLETED" });
    expect(taskTransition("start", "FAILED_INSPECTION")).toEqual({ next: "IN_PROGRESS" });
  });

  it("rejects illegal transitions", () => {
    expect(taskTransition("complete", "PENDING")).toHaveProperty("problem");
    expect(taskTransition("start", "COMPLETED")).toHaveProperty("problem");
    expect(taskTransition("cancel", "IN_PROGRESS")).toHaveProperty("problem");
    expect(taskTransition("assign", "INSPECTED")).toHaveProperty("problem");
    expect(taskTransition("skip", "COMPLETED")).toHaveProperty("problem");
  });

  it("lets only the assignee or a supervisor work a task", () => {
    const task = { assigneeUserId: "u1" };
    expect(taskActorProblem("complete", task, { userId: "u1", canManage: false })).toBeNull();
    expect(taskActorProblem("complete", task, { userId: "u2", canManage: false })).toMatch(
      /another attendant/,
    );
    expect(taskActorProblem("complete", task, { userId: "u2", canManage: true })).toBeNull();
    expect(
      taskActorProblem("start", { assigneeUserId: null }, { userId: "u2", canManage: false }),
    ).toBeNull();
    expect(
      taskActorProblem("complete", { assigneeUserId: null }, { userId: "u2", canManage: false }),
    ).not.toBeNull();
  });

  it("waits for inspection when the type or the property requires it", () => {
    expect(
      needsInspection({ typeRequiresInspection: true, propertyRequiresInspected: false }),
    ).toBe(true);
    expect(
      needsInspection({ typeRequiresInspection: false, propertyRequiresInspected: true }),
    ).toBe(true);
    expect(
      needsInspection({ typeRequiresInspection: false, propertyRequiresInspected: false }),
    ).toBe(false);
  });

  it("derives cleaning priority from arrivals and maintenance", () => {
    expect(cleaningPriority({ arrivingToday: true, afterMaintenance: true })).toBe("URGENT");
    expect(cleaningPriority({ arrivingToday: false, afterMaintenance: true })).toBe("PRIORITY");
    expect(cleaningPriority({ arrivingToday: false, afterMaintenance: false })).toBe("NORMAL");
    expect(priorityLabel(PRIORITY_VALUES.URGENT)).toBe("URGENT");
    expect(priorityLabel(75)).toBe("NORMAL");
    expect(priorityLabel(50)).toBe("PRIORITY");
  });
});

describe("maintenance state machine", () => {
  it("follows open → assigned → in progress → resolved → closed", () => {
    expect(maintenanceTransition("assign", "OPEN")).toEqual({ next: "ASSIGNED" });
    expect(maintenanceTransition("assign", "IN_PROGRESS")).toEqual({ next: "IN_PROGRESS" });
    expect(maintenanceTransition("start", "ASSIGNED")).toEqual({ next: "IN_PROGRESS" });
    expect(maintenanceTransition("hold", "IN_PROGRESS")).toEqual({ next: "ON_HOLD" });
    expect(maintenanceTransition("resume", "ON_HOLD")).toEqual({ next: "IN_PROGRESS" });
    expect(maintenanceTransition("resolve", "IN_PROGRESS")).toEqual({ next: "RESOLVED" });
    expect(maintenanceTransition("close", "RESOLVED")).toEqual({ next: "CLOSED" });
    expect(maintenanceTransition("reopen", "RESOLVED")).toEqual({ next: "IN_PROGRESS" });
  });

  it("rejects illegal transitions", () => {
    expect(maintenanceTransition("close", "OPEN")).toHaveProperty("problem");
    expect(maintenanceTransition("resolve", "OPEN")).toHaveProperty("problem");
    expect(maintenanceTransition("start", "CLOSED")).toHaveProperty("problem");
    expect(maintenanceTransition("cancel", "IN_PROGRESS")).toHaveProperty("problem");
    expect(maintenanceTransition("assign", "RESOLVED")).toHaveProperty("problem");
  });

  it("lets only the assignee or a manager work a request", () => {
    const request = { assigneeId: "u1" };
    expect(
      maintenanceActorProblem("resolve", request, { userId: "u1", canManage: false }),
    ).toBeNull();
    expect(
      maintenanceActorProblem("resolve", request, { userId: "u2", canManage: false }),
    ).not.toBeNull();
    expect(
      maintenanceActorProblem("resolve", request, { userId: "u2", canManage: true }),
    ).toBeNull();
    expect(
      maintenanceActorProblem("start", { assigneeId: null }, { userId: "u2", canManage: false }),
    ).toBeNull();
  });
});

describe("contracts", () => {
  it("never accepts a target status from the client", () => {
    expect(inspectRoomSchema.safeParse({ version: 1, outcome: "PASS" }).success).toBe(true);
    expect(inspectRoomSchema.safeParse({ version: 1, outcome: "FAIL" }).success).toBe(false);
    expect(
      inspectRoomSchema.safeParse({ version: 1, outcome: "PASS", housekeepingStatus: "INSPECTED" })
        .success,
    ).toBe(false);
  });

  it("validates room blocks and blocking maintenance requests", () => {
    expect(
      placeBlockSchema.safeParse({
        kind: "OUT_OF_ORDER",
        to: "2026-10-12",
        reasonCodeId: ID,
        reason: "Leak",
      }).success,
    ).toBe(true);
    expect(
      placeBlockSchema.safeParse({
        kind: "OUT_OF_ORDER",
        from: "2026-10-12",
        to: "2026-10-12",
        reasonCodeId: ID,
        reason: "Leak",
      }).success,
    ).toBe(false);
    const base = { categoryId: ID, title: "Leaking tap" };
    expect(createRequestSchema.safeParse(base).success).toBe(false); // room or location
    expect(createRequestSchema.safeParse({ ...base, location: "Lobby" }).success).toBe(true);
    expect(
      createRequestSchema.safeParse({
        ...base,
        roomId: ID,
        blockRoom: { kind: "OUT_OF_ORDER", to: "2026-10-12", reasonCodeId: ID },
      }).success,
    ).toBe(false); // blocking needs a reason
  });
});
