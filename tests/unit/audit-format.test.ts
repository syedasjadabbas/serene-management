import { describe, expect, it } from "vitest";
import { auditActionLabel, auditChanges } from "@/components/audit/audit-format";

describe("audit presentation", () => {
  it("labels known actions and words unknown ones", () => {
    expect(auditActionLabel("stay.reverse_check_in")).toBe("Check-in reversed");
    expect(auditActionLabel("housekeeping.room_mark_clean")).toBe("Housekeeping: room mark clean");
  });

  it("renders nested records readably, without ids or raw JSON", () => {
    const roomTypeId = "01a0d350-621c-711d-883b-2c455941b43d";
    const changes = auditChanges(null, {
      nights: [
        { date: "2026-10-13", rooms: 1, roomTypeId },
        { date: "2026-10-14", rooms: 2, roomTypeId },
      ],
      folio: { balance: "0.0000", settled: [1], windows: 1 },
      itemIds: [roomTypeId],
      meta: { permission: "groups:manage" },
    });
    const text = JSON.stringify(changes);
    expect(text).not.toContain(roomTypeId);
    expect(text).not.toMatch(/[{]\\"/);
    expect(changes.map((c) => c.key)).toEqual(["nights", "folio"]);
    expect(changes[0]!.after).toBe("Date 2026-10-13, rooms 1; Date 2026-10-14, rooms 2");
    expect(changes[1]!.after).toBe("Balance 0.00, settled 1, windows 1");
  });
});
