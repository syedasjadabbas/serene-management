import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingApi } from "@/global/api/endpoints/billingApi";
import { groupsApi } from "@/global/api/endpoints/groupsApi";
import { bookingGuestsApi } from "@/global/api/endpoints/guestsApi";
import { housekeepingApi } from "@/global/api/endpoints/housekeepingApi";
import { maintenanceApi } from "@/global/api/endpoints/maintenanceApi";
import { nightAuditApi } from "@/global/api/endpoints/nightAuditApi";
import { orgOptionsTag } from "@/global/api/endpoints/optionsTags";
import { organizationApi } from "@/global/api/endpoints/organizationApi";
import { ratesApi } from "@/global/api/endpoints/ratesApi";
import { reservationsApi } from "@/global/api/endpoints/reservationsApi";
import { roomsApi } from "@/global/api/endpoints/roomsApi";
import { setupApi } from "@/global/api/endpoints/setupApi";
import { resetBootForTests } from "@/global/api/session";
import { makeStore } from "@/global/api/store";
import { useAuthStore } from "@/global/stores/auth.store";

/**
 * Option/picker queries keep data for five minutes, so the mutations that
 * change their reference data must refetch them — for the property that
 * changed and no other. Exercised through a real store with a mocked fetch.
 */

const A = "prop-a";
const B = "prop-b";

type Store = ReturnType<typeof makeStore>;
type Thunk = (store: Store) => unknown;

let requests: string[] = [];

beforeEach(() => {
  resetBootForTests();
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useAuthStore.getState().setSession("token", 900);
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | Request, init?: RequestInit) => {
      const request = typeof input === "string" ? null : input;
      const method = request?.method ?? init?.method ?? "GET";
      requests.push(`${method} ${request?.url ?? String(input)}`);
      return new Response(JSON.stringify({ success: true, message: "OK", data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const hits = (path: string) =>
  requests.filter((entry) => entry.startsWith("GET") && entry.endsWith(path)).length;

const subscriptions: Record<string, Thunk> = {
  roomPicker: (s) => s.dispatch(roomsApi.endpoints.roomPicker.initiate(A)),
  roomPickerB: (s) => s.dispatch(roomsApi.endpoints.roomPicker.initiate(B)),
  roomBoardOptions: (s) => s.dispatch(roomsApi.endpoints.roomBoardOptions.initiate(A)),
  bookingOptions: (s) => s.dispatch(reservationsApi.endpoints.bookingOptions.initiate(A)),
  housekeepingOptions: (s) => s.dispatch(housekeepingApi.endpoints.housekeepingOptions.initiate(A)),
  maintenanceOptions: (s) => s.dispatch(maintenanceApi.endpoints.maintenanceOptions.initiate(A)),
  groupOptions: (s) => s.dispatch(groupsApi.endpoints.groupOptions.initiate(A)),
  billingOptions: (s) => s.dispatch(billingApi.endpoints.billingOptions.initiate(A)),
  guestOptions: (s) => s.dispatch(bookingGuestsApi.endpoints.guestOptions.initiate()),
};

const PATHS: Record<string, string> = {
  roomPicker: `/properties/${A}/rooms/picker`,
  roomPickerB: `/properties/${B}/rooms/picker`,
  roomBoardOptions: `/properties/${A}/rooms/board-options`,
  bookingOptions: `/properties/${A}/booking-options`,
  housekeepingOptions: `/properties/${A}/housekeeping/options`,
  maintenanceOptions: `/properties/${A}/maintenance/options`,
  groupOptions: `/properties/${A}/groups/options`,
  billingOptions: `/properties/${A}/billing/options`,
  guestOptions: "/guests/options",
};

/** Subscribes to every option query, runs `change`, returns each one's refetch count. */
async function refetches(change: Thunk): Promise<Record<string, number>> {
  const store = makeStore();
  for (const subscribe of Object.values(subscriptions)) await subscribe(store);
  await settle();
  const before = Object.fromEntries(Object.entries(PATHS).map(([key, path]) => [key, hits(path)]));
  await change(store);
  await settle();
  return Object.fromEntries(
    Object.entries(PATHS).map(([key, path]) => [key, hits(path) - (before[key] ?? 0)]),
  );
}

const refetched = (result: Record<string, number>) =>
  Object.keys(result)
    .filter((key) => (result[key] ?? 0) > 0)
    .sort();

describe("option queries are refreshed by the mutations that change their data", () => {
  it("setup changes refresh the changed property's pickers and filters only", async () => {
    const result = await refetches((s) =>
      s.dispatch(setupApi.endpoints.createRoomType.initiate({ propertyId: A, body: {} as never })),
    );
    expect(refetched(result)).toEqual(
      [
        "billingOptions",
        "bookingOptions",
        "groupOptions",
        "housekeepingOptions",
        "maintenanceOptions",
        "roomBoardOptions",
        "roomPicker",
      ].sort(),
    );
    // Another property's picker and the org-level guest options are untouched.
    expect(result.roomPickerB).toBe(0);
    expect(result.guestOptions).toBe(0);
  });

  it("does not refresh a property's options for a setup change on another property", async () => {
    const result = await refetches((s) =>
      s.dispatch(setupApi.endpoints.createRooms.initiate({ propertyId: B, body: {} as never })),
    );
    expect(result.roomPicker).toBe(0);
    expect(result.roomPickerB).toBe(1);
  });

  const cases: [string, Thunk][] = [
    [
      "property configuration",
      (s) =>
        s.dispatch(
          setupApi.endpoints.updatePropertyConfiguration.initiate({
            propertyId: A,
            body: {} as never,
          }),
        ),
    ],
    [
      "go-live",
      (s) =>
        s.dispatch(
          setupApi.endpoints.initializeBusinessDate.initiate({
            propertyId: A,
            body: { date: "2026-01-01", reason: "go live" },
          }),
        ),
    ],
    [
      "copy setup into the property",
      (s) =>
        s.dispatch(
          organizationApi.endpoints.copyPropertySetup.initiate({
            targetId: A,
            sourceId: B,
            reason: "copy",
          }),
        ),
    ],
    [
      "night audit start (business date)",
      (s) =>
        s.dispatch(
          nightAuditApi.endpoints.startNightAudit.initiate({
            propertyId: A,
            reason: "roll",
            idempotencyKey: "k",
          }),
        ),
    ],
  ];
  it.each(cases)("%s refreshes the property's options", async (_name, change) => {
    const result = await refetches(change);
    expect(result.bookingOptions).toBe(1);
    expect(result.groupOptions).toBe(1);
    expect(result.billingOptions).toBe(1);
    expect(result.roomPickerB).toBe(0);
  });

  it("rate-plan create refreshes booking and group options; a season edit does not", async () => {
    const create = await refetches((s) =>
      s.dispatch(ratesApi.endpoints.createRatePlan.initiate({ propertyId: A, body: {} as never })),
    );
    expect(create.bookingOptions).toBe(1);
    expect(create.groupOptions).toBe(1);
    requests = [];
    const season = await refetches((s) =>
      s.dispatch(
        ratesApi.endpoints.saveSeason.initiate({
          propertyId: A,
          ratePlanId: "rp",
          body: {} as never,
        }),
      ),
    );
    expect(season.bookingOptions).toBe(0);
  });

  it("user changes refresh the assignee pickers, not the room pickers", async () => {
    const result = await refetches((s) =>
      s.dispatch(
        organizationApi.endpoints.userStatus.initiate({
          userId: "u1",
          action: "disable",
          reason: "left",
        }),
      ),
    );
    expect(refetched(result)).toEqual(["housekeepingOptions", "maintenanceOptions"]);
  });

  it("org-level guest options hang off the organization tag only", async () => {
    const result = await refetches((s) =>
      s.dispatch(bookingGuestsApi.util.invalidateTags([orgOptionsTag()])),
    );
    expect(refetched(result)).toEqual(["guestOptions"]);
  });
});
