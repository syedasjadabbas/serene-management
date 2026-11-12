import { describe, expect, it } from "vitest";
import {
  addTaskBody,
  addTaskDefaults,
  addTaskFormSchema,
} from "@/app/(workspace)/[propertyCode]/housekeeping/_lib/addTaskForm";
import {
  addPackageBody,
  addPackageDefaults,
  addPackageFormSchema,
  sanitizeQuantity,
} from "@/app/(workspace)/[propertyCode]/reservations/[reservationId]/_lib/addPackageForm";
import {
  allocationFormSchema,
  blockAllocations,
  newBlockBody,
  newBlockDefaults,
  newBlockFormSchema,
  pickupFormSchema,
  pickupDefaults,
  releaseBody,
  releaseDefaults,
  renameServerFields,
} from "@/app/(workspace)/[propertyCode]/groups/_lib/groupForms";
import {
  nightAuditReasonSchema,
  runDefaults,
} from "@/app/(workspace)/[propertyCode]/night-audit/_lib/reasonForm";
import type { ClientApiError } from "@/global/api/errors";

const issues = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("add housekeeping task form", () => {
  const schema = addTaskFormSchema("2026-11-12", "2026-12-12");
  it("defaults to today, normal priority, nothing selected", () => {
    const d = addTaskDefaults("2026-11-12");
    expect(d).toMatchObject({ date: "2026-11-12", priority: "NORMAL", roomId: "" });
    expect(issues(schema.safeParse(d))).toMatchObject({ roomId: "Select a room" });
  });
  it("flags short descriptions and out-of-window dates", () => {
    const base = { ...addTaskDefaults("2026-11-12"), roomId: "r", taskTypeId: "t" };
    expect(schema.safeParse(base).success).toBe(true);
    expect(issues(schema.safeParse({ ...base, description: "ab" })).description).toBe(
      "Use at least 3 characters",
    );
    expect(issues(schema.safeParse({ ...base, date: "" })).date).toBe("Choose a date");
    expect(schema.safeParse({ ...base, date: "2027-03-01" }).success).toBe(false);
  });
  it("builds a body with only the filled optional parts", () => {
    const v = { ...addTaskDefaults("2026-11-12"), roomId: "r", taskTypeId: "t" };
    expect(addTaskBody(v, "2026-11-12")).toEqual({
      roomId: "r",
      taskTypeId: "t",
      priority: "NORMAL",
    });
    expect(
      addTaskBody(
        { ...v, date: "2026-11-14", time: "09:00", notes: " n ", assigneeId: "a" },
        "2026-11-12",
      ),
    ).toMatchObject({
      scheduledDate: "2026-11-14",
      scheduledTime: "09:00",
      notes: "n",
      assigneeId: "a",
    });
  });
});

describe("add package form", () => {
  it("requires a package and a quantity of at least 1", () => {
    const d = addPackageDefaults("2026-11-12", "2026-11-14");
    expect(d.quantity).toBe("1");
    expect(issues(addPackageFormSchema.safeParse(d)).packageId).toBe("Choose a package");
    expect(addPackageFormSchema.safeParse({ ...d, packageId: "p", quantity: "0" }).success).toBe(
      false,
    );
    expect(addPackageFormSchema.safeParse({ ...d, packageId: "p" }).success).toBe(true);
  });
  it("sanitizes the quantity and parses it for the API", () => {
    expect(sanitizeQuantity("a1b2c3")).toBe("12");
    expect(
      addPackageBody({ packageId: "p", quantity: "3", startDate: "a", endDate: "b" }).quantity,
    ).toBe(3);
  });
});

describe("group block forms", () => {
  it("new block needs rooms for one room type and a reason when overriding", () => {
    const d = {
      ...newBlockDefaults("2026-11-12"),
      code: "B1",
      name: "n",
      statusId: "s",
      ratePlanId: "r",
    };
    expect(d.endDate).toBe("2026-11-13");
    expect(issues(newBlockFormSchema.safeParse(d)).rooms).toMatch(/at least one room type/);
    const ok = { ...d, rooms: { rt1: "2", rt2: "0" } };
    expect(newBlockFormSchema.safeParse(ok).success).toBe(true);
    expect(
      issues(newBlockFormSchema.safeParse({ ...ok, override: true, reason: "x" })).reason,
    ).toBe("Enter a reason of at least 3 characters");
    expect(newBlockBody(ok)).toMatchObject({
      cutoffDate: null,
      allocations: [{ roomTypeId: "rt1", rooms: 2 }],
      reason: undefined,
    });
  });
  it("allocation needs rooms; release needs a reason", () => {
    expect(
      issues(
        allocationFormSchema.safeParse({
          roomTypeId: "a",
          from: "2026-11-12",
          to: "2026-11-13",
          rooms: "",
          override: false,
          reason: "",
        }),
      ).rooms,
    ).toBe("Enter the rooms per night");
    const rd = releaseDefaults("2026-11-12", "2026-11-15");
    expect(rd.to).toBe("2026-11-14");
    expect(releaseBody({ ...rd, reason: " why " }, 4)).toMatchObject({
      version: 4,
      reason: "why",
      roomTypeId: undefined,
    });
  });
  it("pickup needs a guest", () => {
    const d = pickupDefaults("rt", "2026-11-12", "2026-11-14");
    expect(issues(pickupFormSchema.safeParse(d)).guest).toBe("Choose a guest");
    expect(pickupFormSchema.safeParse({ ...d, guest: { id: "g", label: "G" } }).success).toBe(true);
  });
  it("counts only positive allocations and renames server fields", () => {
    expect(blockAllocations({ a: "0", b: "3" })).toEqual([{ roomTypeId: "b", rooms: 3 }]);
    const error = { fieldErrors: { allocations: ["x"], code: ["y"] } } as unknown as ClientApiError;
    expect(renameServerFields(error, { allocations: "rooms" })?.fieldErrors).toEqual({
      rooms: ["x"],
      code: ["y"],
    });
  });
});

describe("night audit reason form", () => {
  it("starts with End of day and rejects short reasons", () => {
    expect(nightAuditReasonSchema.safeParse(runDefaults).success).toBe(true);
    expect(nightAuditReasonSchema.safeParse({ reason: " ab " }).success).toBe(false);
  });
});
