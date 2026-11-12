import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { API, API_ORIGIN_PATHS } from "@/global/constants/api";

/** The URLs the endpoint files used to build inline, written out literally (sample id: `<param>-1`). */
const EXPECTED: [string, string][] = [
  [API.accounts.accounts(), "/accounts"],
  [API.accounts.account("accountId-1"), "/accounts/accountId-1"],
  [
    API.accounts.accountContact("accountId-1", "guestId-1"),
    "/accounts/accountId-1/contacts/guestId-1",
  ],
  [API.billing.billingOptions("propertyId-1"), "/properties/propertyId-1/billing/options"],
  [API.billing.folios("propertyId-1"), "/properties/propertyId-1/folios"],
  [
    API.billing.reservationRoomFolio("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/folio",
  ],
  [
    API.billing.folioItems("propertyId-1", "folioId-1"),
    "/properties/propertyId-1/folios/folioId-1/items",
  ],
  [
    API.billing.reservationRoomFolioHistory("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/folio/history",
  ],
  [
    API.billing.folioChargesPreview("propertyId-1", "folioId-1"),
    "/properties/propertyId-1/folios/folioId-1/charges/preview",
  ],
  [
    API.billing.folioCharges("propertyId-1", "folioId-1"),
    "/properties/propertyId-1/folios/folioId-1/charges",
  ],
  [
    API.billing.reservationRoomRoomCharges("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/room-charges",
  ],
  [
    API.billing.folioPayments("propertyId-1", "folioId-1"),
    "/properties/propertyId-1/folios/folioId-1/payments",
  ],
  [
    API.billing.folioItemReverse("propertyId-1", "itemId-1"),
    "/properties/propertyId-1/folio-items/itemId-1/reverse",
  ],
  [
    API.billing.folioItemAdjust("propertyId-1", "itemId-1"),
    "/properties/propertyId-1/folio-items/itemId-1/adjust",
  ],
  [
    API.billing.paymentVoid("propertyId-1", "paymentId-1"),
    "/properties/propertyId-1/payments/paymentId-1/void",
  ],
  [
    API.billing.paymentRefund("propertyId-1", "paymentId-1"),
    "/properties/propertyId-1/payments/paymentId-1/refund",
  ],
  [
    API.billing.folioSettle("propertyId-1", "folioId-1"),
    "/properties/propertyId-1/folios/folioId-1/settle",
  ],
  [API.frontDesk.frontDeskSummary("propertyId-1"), "/properties/propertyId-1/front-desk/summary"],
  [API.frontDesk.frontDeskArrivals("propertyId-1"), "/properties/propertyId-1/front-desk/arrivals"],
  [API.frontDesk.frontDeskInHouse("propertyId-1"), "/properties/propertyId-1/front-desk/in-house"],
  [
    API.frontDesk.frontDeskDepartures("propertyId-1"),
    "/properties/propertyId-1/front-desk/departures",
  ],
  [API.frontDesk.frontDeskRooms("propertyId-1"), "/properties/propertyId-1/front-desk/rooms"],
  [
    API.frontDesk.reservationRoomRoomOptions("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/room-options",
  ],
  [API.frontDesk.stay("propertyId-1", "stayId-1"), "/properties/propertyId-1/stays/stayId-1"],
  [
    API.frontDesk.reservationRoomCheckIn("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/check-in",
  ],
  [API.frontDesk.frontDeskWalkIns("propertyId-1"), "/properties/propertyId-1/front-desk/walk-ins"],
  [
    API.frontDesk.stayRoomMove("propertyId-1", "stayId-1"),
    "/properties/propertyId-1/stays/stayId-1/room-move",
  ],
  [
    API.frontDesk.stayCheckOut("propertyId-1", "stayId-1"),
    "/properties/propertyId-1/stays/stayId-1/check-out",
  ],
  [
    API.frontDesk.stayExtend("propertyId-1", "stayId-1"),
    "/properties/propertyId-1/stays/stayId-1/extend",
  ],
  [
    API.frontDesk.stayReverseCheckIn("propertyId-1", "stayId-1"),
    "/properties/propertyId-1/stays/stayId-1/reverse-check-in",
  ],
  [API.groups.groupsOptions("propertyId-1"), "/properties/propertyId-1/groups/options"],
  [API.groups.groups("propertyId-1"), "/properties/propertyId-1/groups"],
  [API.groups.group("propertyId-1", "groupId-1"), "/properties/propertyId-1/groups/groupId-1"],
  [
    API.groups.groupStatus("propertyId-1", "groupId-1"),
    "/properties/propertyId-1/groups/groupId-1/status",
  ],
  [
    API.groups.groupBlocks("propertyId-1", "groupId-1"),
    "/properties/propertyId-1/groups/groupId-1/blocks",
  ],
  [
    API.groups.blockAllocation("propertyId-1", "blockId-1"),
    "/properties/propertyId-1/blocks/blockId-1/allocation",
  ],
  [
    API.groups.blockStatus("propertyId-1", "blockId-1"),
    "/properties/propertyId-1/blocks/blockId-1/status",
  ],
  [
    API.groups.blockRelease("propertyId-1", "blockId-1"),
    "/properties/propertyId-1/blocks/blockId-1/release",
  ],
  [
    API.groups.blockPickups("propertyId-1", "blockId-1"),
    "/properties/propertyId-1/blocks/blockId-1/pickups",
  ],
  [API.guests.guests(), "/guests"],
  [API.guests.guestsOptions(), "/guests/options"],
  [API.guests.guest("guestId-1"), "/guests/guestId-1"],
  [API.guests.guestHistory("guestId-1"), "/guests/guestId-1/history"],
  [API.guests.guestPreferences("guestId-1"), "/guests/guestId-1/preferences"],
  [API.guests.guestNotes("guestId-1"), "/guests/guestId-1/notes"],
  [API.guests.guestNote("guestId-1", "noteId-1"), "/guests/guestId-1/notes/noteId-1"],
  [API.guests.guestLoyalty("guestId-1"), "/guests/guestId-1/loyalty"],
  [
    API.housekeeping.housekeepingSummary("propertyId-1"),
    "/properties/propertyId-1/housekeeping/summary",
  ],
  [
    API.housekeeping.housekeepingOptions("propertyId-1"),
    "/properties/propertyId-1/housekeeping/options",
  ],
  [
    API.housekeeping.housekeepingTasks("propertyId-1"),
    "/properties/propertyId-1/housekeeping/tasks",
  ],
  [
    API.housekeeping.housekeepingTaskAssign("propertyId-1", "taskId-1"),
    "/properties/propertyId-1/housekeeping/tasks/taskId-1/assign",
  ],
  [
    API.housekeeping.housekeepingTaskAction("propertyId-1", "taskId-1", "action-1"),
    "/properties/propertyId-1/housekeeping/tasks/taskId-1/action-1",
  ],
  [API.loyalty.loyaltyPrograms(), "/loyalty/programs"],
  [API.loyalty.loyaltyProgramMembers("programId-1"), "/loyalty/programs/programId-1/members"],
  [API.loyalty.loyaltyProgram("programId-1"), "/loyalty/programs/programId-1"],
  [API.loyalty.loyaltyProgramTiers("programId-1"), "/loyalty/programs/programId-1/tiers"],
  [API.loyalty.loyaltyTier("tierId-1"), "/loyalty/tiers/tierId-1"],
  [API.loyalty.loyaltyMembership("membershipId-1"), "/loyalty/memberships/membershipId-1"],
  [
    API.loyalty.loyaltyMembershipAdjustments("membershipId-1"),
    "/loyalty/memberships/membershipId-1/adjustments",
  ],
  [
    API.maintenance.maintenanceSummary("propertyId-1"),
    "/properties/propertyId-1/maintenance/summary",
  ],
  [
    API.maintenance.maintenanceOptions("propertyId-1"),
    "/properties/propertyId-1/maintenance/options",
  ],
  [API.maintenance.maintenance("propertyId-1"), "/properties/propertyId-1/maintenance"],
  [
    API.maintenance.maintenanceRequest("propertyId-1", "requestId-1"),
    "/properties/propertyId-1/maintenance/requestId-1",
  ],
  [
    API.maintenance.maintenanceAction("propertyId-1", "requestId-1", "action-1"),
    "/properties/propertyId-1/maintenance/requestId-1/action-1",
  ],
  [
    API.nightAudit.nightAuditsReadiness("propertyId-1"),
    "/properties/propertyId-1/night-audits/readiness",
  ],
  [API.nightAudit.nightAudits("propertyId-1"), "/properties/propertyId-1/night-audits"],
  [
    API.nightAudit.nightAudit("propertyId-1", "runId-1"),
    "/properties/propertyId-1/night-audits/runId-1",
  ],
  [
    API.nightAudit.nightAuditRecover("propertyId-1", "runId-1"),
    "/properties/propertyId-1/night-audits/runId-1/recover",
  ],
  [API.organization.organizationOverview(), "/organization/overview"],
  [API.organization.organizationReportsPerformance(), "/organization/reports/performance"],
  [API.organization.availability(), "/availability"],
  [API.organization.auditLogs(), "/audit-logs"],
  [API.organization.users(), "/users"],
  [API.organization.roles(), "/roles"],
  [API.organization.userRoleAssignments("userId-1"), "/users/userId-1/role-assignments"],
  [
    API.organization.userRoleAssignment("userId-1", "assignmentId-1"),
    "/users/userId-1/role-assignments/assignmentId-1",
  ],
  [API.organization.userAction("userId-1", "action-1"), "/users/userId-1/action-1"],
  [API.organization.userPasswordReset("userId-1"), "/users/userId-1/password-reset"],
  [API.organization.properties(), "/properties"],
  [
    API.organization.setupCopyFrom("targetId-1", "sourceId-1"),
    "/properties/targetId-1/setup/copy-from/sourceId-1",
  ],
  [API.properties.businessDate("propertyId-1"), "/properties/propertyId-1/business-date"],
  [API.rates.ratesOptions("propertyId-1"), "/properties/propertyId-1/rates/options"],
  [API.rates.ratePlans("propertyId-1"), "/properties/propertyId-1/rate-plans"],
  [
    API.rates.ratePlan("propertyId-1", "ratePlanId-1"),
    "/properties/propertyId-1/rate-plans/ratePlanId-1",
  ],
  [API.rates.ratesCalendar("propertyId-1"), "/properties/propertyId-1/rates/calendar"],
  [API.rates.restrictions("propertyId-1"), "/properties/propertyId-1/restrictions"],
  [API.rates.packages("propertyId-1"), "/properties/propertyId-1/packages"],
  [
    API.rates.package("propertyId-1", "packageId-1"),
    "/properties/propertyId-1/packages/packageId-1",
  ],
  [
    API.rates.ratePlanSeasons("propertyId-1", "ratePlanId-1"),
    "/properties/propertyId-1/rate-plans/ratePlanId-1/seasons",
  ],
  [
    API.rates.ratePlanSeason("propertyId-1", "ratePlanId-1", "seasonId-1"),
    "/properties/propertyId-1/rate-plans/ratePlanId-1/seasons/seasonId-1",
  ],
  [
    API.rates.ratePlanPackages("propertyId-1", "ratePlanId-1"),
    "/properties/propertyId-1/rate-plans/ratePlanId-1/packages",
  ],
  [
    API.rates.ratePlanAccounts("propertyId-1", "ratePlanId-1"),
    "/properties/propertyId-1/rate-plans/ratePlanId-1/accounts",
  ],
  [
    API.reports.reportExport("propertyId-1", "reportKey-1"),
    "/properties/propertyId-1/reports/reportKey-1/export",
  ],
  [API.reports.reports("propertyId-1"), "/properties/propertyId-1/reports"],
  [
    API.reports.report("propertyId-1", "reportKey-1"),
    "/properties/propertyId-1/reports/reportKey-1",
  ],
  [API.reports.dashboard("propertyId-1"), "/properties/propertyId-1/dashboard"],
  [API.reservations.availability("propertyId-1"), "/properties/propertyId-1/availability"],
  [API.reservations.bookingOptions("propertyId-1"), "/properties/propertyId-1/booking-options"],
  [API.reservations.roomsAvailable("propertyId-1"), "/properties/propertyId-1/rooms/available"],
  [API.reservations.reservations("propertyId-1"), "/properties/propertyId-1/reservations"],
  [
    API.reservations.reservation("propertyId-1", "reservationId-1"),
    "/properties/propertyId-1/reservations/reservationId-1",
  ],
  [
    API.reservations.reservationRoom("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1",
  ],
  [
    API.reservations.reservationRoomConfirm("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/confirm",
  ],
  [
    API.reservations.reservationRoomCancel("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/cancel",
  ],
  [
    API.reservations.reservationRoomNoShow("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/no-show",
  ],
  [
    API.reservations.reservationRoomReinstate("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/reinstate",
  ],
  [
    API.reservations.reservationRoomReinstateNoShow("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/reinstate-no-show",
  ],
  [
    API.reservations.reservationCompany("propertyId-1", "reservationId-1"),
    "/properties/propertyId-1/reservations/reservationId-1/company",
  ],
  [
    API.reservations.reservationRoomAssignRoom("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/assign-room",
  ],
  [
    API.reservations.reservationRoomChargeEstimate("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/charge-estimate",
  ],
  [
    API.reservations.reservationRoomPackages("propertyId-1", "reservationRoomId-1"),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/packages",
  ],
  [
    API.reservations.reservationRoomPackage(
      "propertyId-1",
      "reservationRoomId-1",
      "reservationPackageId-1",
    ),
    "/properties/propertyId-1/reservation-rooms/reservationRoomId-1/packages/reservationPackageId-1",
  ],
  [API.rooms.roomsPicker("propertyId-1"), "/properties/propertyId-1/rooms/picker"],
  [API.rooms.roomsBoard("propertyId-1"), "/properties/propertyId-1/rooms/board"],
  [API.rooms.roomsBoardOptions("propertyId-1"), "/properties/propertyId-1/rooms/board-options"],
  [API.rooms.room("propertyId-1", "roomId-1"), "/properties/propertyId-1/rooms/roomId-1"],
  [
    API.rooms.roomBlocks("propertyId-1", "roomId-1"),
    "/properties/propertyId-1/rooms/roomId-1/blocks",
  ],
  [
    API.rooms.roomBlockRelease("propertyId-1", "blockId-1"),
    "/properties/propertyId-1/room-blocks/blockId-1/release",
  ],
  [
    API.rooms.roomInspect("propertyId-1", "roomId-1"),
    "/properties/propertyId-1/rooms/roomId-1/inspect",
  ],
  [
    API.rooms.roomAction("propertyId-1", "roomId-1", "action-1"),
    "/properties/propertyId-1/rooms/roomId-1/action-1",
  ],
  [API.search.propertySearch("propertyId-1"), "/properties/propertyId-1/search"],
  [API.search.organizationSearch(), "/search"],
  [API.auth.refresh(), "/auth/refresh"],
  [API.auth.me(), "/me"],
  [API.auth.authLogin(), "/auth/login"],
  [API.auth.authLogout(), "/auth/logout"],
  [API.auth.authSessions(), "/auth/sessions"],
  [API.auth.authSession("sessionId-1"), "/auth/sessions/sessionId-1"],
  [API.auth.authPassword(), "/auth/password"],
  [API.auth.meAvatar(), "/me/avatar"],
  [API.auth.authPasswordReset(), "/auth/password/reset"],
  [API.setup.setup("propertyId-1"), "/properties/propertyId-1/setup"],
  [API.setup.setupRoomTypes("propertyId-1"), "/properties/propertyId-1/setup/room-types"],
  [
    API.setup.setupRoomType("propertyId-1", "roomTypeId-1"),
    "/properties/propertyId-1/setup/room-types/roomTypeId-1",
  ],
  [API.setup.setupFloors("propertyId-1"), "/properties/propertyId-1/setup/floors"],
  [
    API.setup.setupFloor("propertyId-1", "floorId-1"),
    "/properties/propertyId-1/setup/floors/floorId-1",
  ],
  [API.setup.setupRooms("propertyId-1"), "/properties/propertyId-1/setup/rooms"],
  [
    API.setup.setupRoom("propertyId-1", "roomId-1"),
    "/properties/propertyId-1/setup/rooms/roomId-1",
  ],
  [API.setup.setupTaxes("propertyId-1"), "/properties/propertyId-1/setup/taxes"],
  [
    API.setup.setupTax("propertyId-1", "taxRuleId-1"),
    "/properties/propertyId-1/setup/taxes/taxRuleId-1",
  ],
  [API.setup.configuration("propertyId-1"), "/properties/propertyId-1/configuration"],
  [
    API.setup.businessDateInitialize("propertyId-1"),
    "/properties/propertyId-1/business-date/initialize",
  ],
  [API.realtime.propertyEvents("propertyId-1"), "/properties/propertyId-1/events"],
];

describe("API path catalog", () => {
  it.each(EXPECTED)("%s", (actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("covers every catalog entry", () => {
    const entries = Object.values(API).flatMap((group) => Object.values(group));
    expect(EXPECTED).toHaveLength(entries.length);
  });

  it("keeps the origin-relative health path", () => {
    expect(API_ORIGIN_PATHS.healthLive).toBe("/api/health/live");
  });
});

describe("no inline API paths", () => {
  const root = path.resolve(__dirname, "../../global");
  const files = [
    ...readdirSync(path.join(root, "api/endpoints")).map((f) =>
      path.join(root, "api/endpoints", f),
    ),
    path.join(root, "api/baseApi.ts"),
    path.join(root, "api/session.ts"),
    path.join(root, "api/download.ts"),
    path.join(root, "lib/realtime/client.ts"),
    path.join(root, "lib/offline/verifySession.ts"),
    path.join(root, "lib/offline/useConnectivity.ts"),
  ];

  it.each(files.map((f) => [path.relative(root, f), f]))("%s", (_name, file) => {
    const code = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
      .join("\n");
    expect(code.match(/["'`]\/[a-zA-Z$]/g) ?? []).toEqual([]);
  });
});
