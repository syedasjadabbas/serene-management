import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_MAX_AGE_MS,
  classifySyncResponse,
  minimiseArrival,
  minimiseRoom,
  minimiseStay,
  retryDelayMs,
  snapshotKey,
  snapshotPermissions,
  snapshotUsability,
  snapshotsToDelete,
} from "@/lib/offline/policy";

const NOW = Date.UTC(2026, 8, 29, 12);

describe("offline snapshot keys", () => {
  it("binds every snapshot to one user AND one property", () => {
    expect(snapshotKey("u1", "pA")).toBe("u1:pA");
    expect(snapshotKey("u1", "pA")).not.toBe(snapshotKey("u1", "pB"));
    expect(snapshotKey("u1", "pA")).not.toBe(snapshotKey("u2", "pA"));
  });
});

describe("data minimisation", () => {
  it("drops notes, contact details and internal ids from arrivals", () => {
    const row = {
      reservationRoomId: "rr1",
      reservationId: "r1",
      confirmation: "SMR-1",
      version: 3,
      status: "CONFIRMED",
      state: "PENDING",
      guest: { id: "g1", name: "Ayesha Khan", vip: "VIP1", email: "a@example.com", phone: "+92" },
      arrival: "2026-09-29",
      departure: "2026-10-01",
      nights: 2,
      adults: 2,
      children: 0,
      eta: "14:00",
      roomType: { id: "rt1", code: "DLX", name: "Deluxe" },
      room: { id: "room1", number: "101", housekeepingStatus: "CLEAN" },
      latestNote: "Card on file ends 4242",
    };
    const kept = minimiseArrival(row);
    const text = JSON.stringify(kept);
    expect(text).not.toContain("4242");
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("+92");
    expect(kept).toEqual({
      reservationRoomId: "rr1",
      confirmation: "SMR-1",
      guestName: "Ayesha Khan",
      vip: "VIP1",
      arrival: "2026-09-29",
      departure: "2026-10-01",
      nights: 2,
      adults: 2,
      children: 0,
      eta: "14:00",
      roomType: "DLX",
      room: "101",
      state: "PENDING",
    });
  });

  it("keeps stays and rooms to names, dates and statuses", () => {
    const stay = minimiseStay({
      stayId: "s1",
      confirmation: "SMR-2",
      guest: { name: "Omar", vip: null },
      room: { number: "202" },
      roomType: { code: "STD" },
      arrival: "2026-09-27",
      departure: "2026-09-29",
      stayStatus: "IN_HOUSE",
      checkoutTiming: "DUE",
      latestNote: "private",
    } as Parameters<typeof minimiseStay>[0]);
    expect(Object.keys(stay)).not.toContain("latestNote");
    const room = minimiseRoom({
      id: "room1",
      number: "101",
      roomType: { code: "DLX" },
      floor: null,
      status: "VACANT_READY",
      frontOfficeStatus: "VACANT",
      housekeepingStatus: "CLEAN",
      inHouse: null,
    });
    expect(room).toMatchObject({ floor: null, guest: null, housekeepingStatus: "CLEAN" });
  });
});

describe("snapshot permissions", () => {
  it("includes only the sections the user can read", () => {
    expect(snapshotPermissions(false, ["frontdesk:read"])).toEqual(["frontdesk:read"]);
    expect(snapshotPermissions(false, ["rooms:read", "frontdesk:read"])).toEqual([
      "frontdesk:read",
      "rooms:read",
    ]);
    expect(snapshotPermissions(false, ["guests:read"])).toEqual([]);
    expect(snapshotPermissions(true, [])).toEqual(["frontdesk:read", "rooms:read"]);
  });
});

describe("snapshot usability", () => {
  const snap = { userId: "u1", savedAt: NOW - 60_000, businessDate: "2026-09-29" };

  it("is usable for the same user within the maximum age", () => {
    expect(snapshotUsability(snap, { userId: "u1", now: NOW })).toBe("usable");
  });

  it("is never shown to another user or when nobody is known to be signed in", () => {
    expect(snapshotUsability(snap, { userId: "u2", now: NOW })).toBe("other-user");
    expect(snapshotUsability(snap, { userId: null, now: NOW })).toBe("other-user");
  });

  it("expires after the maximum age, and when saved in the future (clock tampering)", () => {
    expect(
      snapshotUsability(
        { ...snap, savedAt: NOW - SNAPSHOT_MAX_AGE_MS - 1 },
        { userId: "u1", now: NOW },
      ),
    ).toBe("expired");
    expect(
      snapshotUsability({ ...snap, savedAt: NOW + 3_600_000 }, { userId: "u1", now: NOW }),
    ).toBe("expired");
  });

  it("warns when the business date has moved on since the snapshot", () => {
    expect(
      snapshotUsability(snap, { userId: "u1", now: NOW, latestBusinessDate: "2026-09-30" }),
    ).toBe("stale-business-date");
    expect(
      snapshotUsability(snap, { userId: "u1", now: NOW, latestBusinessDate: "2026-09-29" }),
    ).toBe("usable");
  });
});

describe("reconciling snapshots with the live session", () => {
  const stored = [
    { key: "u1:pA", userId: "u1", propertyId: "pA", permissions: ["frontdesk:read" as const] },
    {
      key: "u1:pB",
      userId: "u1",
      propertyId: "pB",
      permissions: ["frontdesk:read" as const, "rooms:read" as const],
    },
    { key: "u2:pA", userId: "u2", propertyId: "pA", permissions: ["frontdesk:read" as const] },
  ];

  it("deletes other users' snapshots", () => {
    const me = {
      userId: "u1",
      isSuperAdmin: false,
      properties: [
        { id: "pA", permissions: ["frontdesk:read"] },
        { id: "pB", permissions: ["frontdesk:read", "rooms:read"] },
      ],
    };
    expect(snapshotsToDelete(stored, me)).toEqual(["u2:pA"]);
  });

  it("deletes snapshots of properties the user lost access to", () => {
    const me = {
      userId: "u1",
      isSuperAdmin: false,
      properties: [{ id: "pA", permissions: ["frontdesk:read"] }],
    };
    expect(snapshotsToDelete(stored, me)).toEqual(["u1:pB", "u2:pA"]);
  });

  it("deletes a snapshot when any permission it was taken under is revoked", () => {
    const me = {
      userId: "u1",
      isSuperAdmin: false,
      properties: [
        { id: "pA", permissions: ["frontdesk:read"] },
        { id: "pB", permissions: ["frontdesk:read"] },
      ],
    };
    expect(snapshotsToDelete(stored, me)).toEqual(["u1:pB", "u2:pA"]);
  });
});

describe("sync outcome classification", () => {
  it("treats 2xx as synced", () => {
    expect(classifySyncResponse(200, null, 0)).toEqual({ kind: "synced" });
    expect(classifySyncResponse(201, null, 0)).toEqual({ kind: "synced" });
  });

  it("never auto-retries a stale version or a business rule: the user resolves it", () => {
    expect(
      classifySyncResponse(409, { code: "CONFLICT", details: { reason: "STALE_VERSION" } }, 0),
    ).toEqual({ kind: "conflict", reason: "STALE_VERSION" });
    expect(classifySyncResponse(422, { code: "INVALID_STATE_TRANSITION" }, 0)).toEqual({
      kind: "conflict",
      reason: "INVALID_STATE_TRANSITION",
    });
    expect(classifySyncResponse(423, { code: "BUSINESS_DATE_LOCKED" }, 0).kind).toBe("conflict");
  });

  it("pauses for re-authentication on 401 and rejects 400/403/404", () => {
    expect(classifySyncResponse(401, null, 0)).toEqual({ kind: "reauthenticate" });
    expect(classifySyncResponse(403, { code: "FORBIDDEN" }, 0)).toEqual({
      kind: "rejected",
      reason: "FORBIDDEN",
    });
    expect(classifySyncResponse(404, null, 0)).toEqual({ kind: "rejected", reason: "HTTP_404" });
    expect(classifySyncResponse(400, { code: "VALIDATION_FAILED" }, 0).kind).toBe("rejected");
  });

  it("retries network failures, rate limits and server errors with capped backoff", () => {
    expect(classifySyncResponse(null, null, 0)).toEqual({ kind: "retry", delayMs: 2_000 });
    expect(classifySyncResponse(429, null, 2)).toEqual({ kind: "retry", delayMs: 8_000 });
    expect(classifySyncResponse(503, null, 1).kind).toBe("retry");
    expect(retryDelayMs(30)).toBe(300_000);
  });
});
