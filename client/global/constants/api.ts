import { ALL_PERMISSIONS, type Permission } from "@serene/shared/lib/permissions/catalog";

/**
 * API base URL (the Express server). `NEXT_PUBLIC_API_URL` is inlined at build
 * time; the default targets the local development server.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000/api/v1"
).replace(/\/+$/, "");

/** Origin of the API server (CSP `connect-src`, health probe). */
export const API_ORIGIN = new URL(API_BASE_URL).origin;

/** Header telling the server which client platform a session belongs to. */
export const CLIENT_PLATFORM_HEADER = "X-Client-Platform";
export const CLIENT_PLATFORM = "web";

/** RTK Query cache tag types (one place, used by `baseApi`). */
export const TAG_TYPES = [
  "Me",
  "Property",
  "BusinessDate",
  "PropertyConfiguration",
  "PropertySetup",
  "Options",
  "AuditLog",
  "Session",
  "Room",
  "RoomStatus",
  "RoomType",
  "Availability",
  "RatePlan",
  "Guest",
  "Account",
  "Loyalty",
  "Reservation",
  "Stay",
  "Folio",
  "Payment",
  "CashierShift",
  "HousekeepingTask",
  "MaintenanceRequest",
  "Group",
  "Block",
  "NightAudit",
  "Report",
  "User",
  "Role",
] as const;

type Upper<S extends string> = Uppercase<S>;
type Flat<S extends string> = S extends `${infer A}:${infer B}`
  ? `${Upper<A>}_${Flat<B>}`
  : Upper<S>;

/**
 * Permission keys as constants, generated from the shared catalog so a typo
 * is a compile error: `P.RESERVATIONS_CANCEL === "reservations:cancel"`.
 * UI gating only; the server decides.
 */
export const P = Object.fromEntries(
  ALL_PERMISSIONS.map((key) => [key.replace(/:/g, "_").toUpperCase(), key]),
) as { readonly [K in Permission as Flat<K>]: K };

/**
 * Typed catalog of API paths, grouped by feature. Every path is relative to
 * `API_BASE_URL` (`/api/v1`) except `API_ORIGIN_PATHS`. Query strings are
 * appended by the callers; ids are interpolated as given (UUIDs and codes).
 * Nothing outside this file spells an API path.
 */
export const API = {
  accounts: {
    accounts: () => "/accounts",
    account: (accountId: string) => `/accounts/${accountId}`,
    accountContact: (accountId: string, guestId: string) =>
      `/accounts/${accountId}/contacts/${guestId}`,
  },
  billing: {
    billingOptions: (propertyId: string) => `/properties/${propertyId}/billing/options`,
    folios: (propertyId: string) => `/properties/${propertyId}/folios`,
    reservationRoomFolio: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/folio`,
    folioItems: (propertyId: string, folioId: string) =>
      `/properties/${propertyId}/folios/${folioId}/items`,
    reservationRoomFolioHistory: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/folio/history`,
    folioChargesPreview: (propertyId: string, folioId: string) =>
      `/properties/${propertyId}/folios/${folioId}/charges/preview`,
    folioCharges: (propertyId: string, folioId: string) =>
      `/properties/${propertyId}/folios/${folioId}/charges`,
    reservationRoomRoomCharges: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/room-charges`,
    folioPayments: (propertyId: string, folioId: string) =>
      `/properties/${propertyId}/folios/${folioId}/payments`,
    folioItemReverse: (propertyId: string, itemId: string) =>
      `/properties/${propertyId}/folio-items/${itemId}/reverse`,
    folioItemAdjust: (propertyId: string, itemId: string) =>
      `/properties/${propertyId}/folio-items/${itemId}/adjust`,
    paymentVoid: (propertyId: string, paymentId: string) =>
      `/properties/${propertyId}/payments/${paymentId}/void`,
    paymentRefund: (propertyId: string, paymentId: string) =>
      `/properties/${propertyId}/payments/${paymentId}/refund`,
    folioSettle: (propertyId: string, folioId: string) =>
      `/properties/${propertyId}/folios/${folioId}/settle`,
  },
  frontDesk: {
    frontDeskSummary: (propertyId: string) => `/properties/${propertyId}/front-desk/summary`,
    frontDeskArrivals: (propertyId: string) => `/properties/${propertyId}/front-desk/arrivals`,
    frontDeskInHouse: (propertyId: string) => `/properties/${propertyId}/front-desk/in-house`,
    frontDeskDepartures: (propertyId: string) => `/properties/${propertyId}/front-desk/departures`,
    frontDeskRooms: (propertyId: string) => `/properties/${propertyId}/front-desk/rooms`,
    reservationRoomRoomOptions: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/room-options`,
    stay: (propertyId: string, stayId: string) => `/properties/${propertyId}/stays/${stayId}`,
    reservationRoomCheckIn: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/check-in`,
    frontDeskWalkIns: (propertyId: string) => `/properties/${propertyId}/front-desk/walk-ins`,
    stayRoomMove: (propertyId: string, stayId: string) =>
      `/properties/${propertyId}/stays/${stayId}/room-move`,
    stayCheckOut: (propertyId: string, stayId: string) =>
      `/properties/${propertyId}/stays/${stayId}/check-out`,
    stayExtend: (propertyId: string, stayId: string) =>
      `/properties/${propertyId}/stays/${stayId}/extend`,
    stayReverseCheckIn: (propertyId: string, stayId: string) =>
      `/properties/${propertyId}/stays/${stayId}/reverse-check-in`,
  },
  groups: {
    groupsOptions: (propertyId: string) => `/properties/${propertyId}/groups/options`,
    groups: (propertyId: string) => `/properties/${propertyId}/groups`,
    group: (propertyId: string, groupId: string) => `/properties/${propertyId}/groups/${groupId}`,
    groupStatus: (propertyId: string, groupId: string) =>
      `/properties/${propertyId}/groups/${groupId}/status`,
    groupBlocks: (propertyId: string, groupId: string) =>
      `/properties/${propertyId}/groups/${groupId}/blocks`,
    blockAllocation: (propertyId: string, blockId: string) =>
      `/properties/${propertyId}/blocks/${blockId}/allocation`,
    blockStatus: (propertyId: string, blockId: string) =>
      `/properties/${propertyId}/blocks/${blockId}/status`,
    blockRelease: (propertyId: string, blockId: string) =>
      `/properties/${propertyId}/blocks/${blockId}/release`,
    blockPickups: (propertyId: string, blockId: string) =>
      `/properties/${propertyId}/blocks/${blockId}/pickups`,
  },
  guests: {
    guests: () => "/guests",
    guestsOptions: () => "/guests/options",
    guest: (guestId: string) => `/guests/${guestId}`,
    guestHistory: (guestId: string) => `/guests/${guestId}/history`,
    guestPreferences: (guestId: string) => `/guests/${guestId}/preferences`,
    guestNotes: (guestId: string) => `/guests/${guestId}/notes`,
    guestNote: (guestId: string, noteId: string) => `/guests/${guestId}/notes/${noteId}`,
    guestLoyalty: (guestId: string) => `/guests/${guestId}/loyalty`,
  },
  housekeeping: {
    housekeepingSummary: (propertyId: string) => `/properties/${propertyId}/housekeeping/summary`,
    housekeepingOptions: (propertyId: string) => `/properties/${propertyId}/housekeeping/options`,
    housekeepingTasks: (propertyId: string) => `/properties/${propertyId}/housekeeping/tasks`,
    housekeepingTaskAssign: (propertyId: string, taskId: string) =>
      `/properties/${propertyId}/housekeeping/tasks/${taskId}/assign`,
    housekeepingTaskAction: (propertyId: string, taskId: string, action: string) =>
      `/properties/${propertyId}/housekeeping/tasks/${taskId}/${action}`,
  },
  loyalty: {
    loyaltyPrograms: () => "/loyalty/programs",
    loyaltyProgramMembers: (programId: string) => `/loyalty/programs/${programId}/members`,
    loyaltyProgram: (programId: string) => `/loyalty/programs/${programId}`,
    loyaltyProgramTiers: (programId: string) => `/loyalty/programs/${programId}/tiers`,
    loyaltyTier: (tierId: string) => `/loyalty/tiers/${tierId}`,
    loyaltyMembership: (membershipId: string) => `/loyalty/memberships/${membershipId}`,
    loyaltyMembershipAdjustments: (membershipId: string) =>
      `/loyalty/memberships/${membershipId}/adjustments`,
  },
  maintenance: {
    maintenanceSummary: (propertyId: string) => `/properties/${propertyId}/maintenance/summary`,
    maintenanceOptions: (propertyId: string) => `/properties/${propertyId}/maintenance/options`,
    maintenance: (propertyId: string) => `/properties/${propertyId}/maintenance`,
    maintenanceRequest: (propertyId: string, requestId: string) =>
      `/properties/${propertyId}/maintenance/${requestId}`,
    maintenanceAction: (propertyId: string, requestId: string, action: string) =>
      `/properties/${propertyId}/maintenance/${requestId}/${action}`,
  },
  nightAudit: {
    nightAuditsReadiness: (propertyId: string) =>
      `/properties/${propertyId}/night-audits/readiness`,
    nightAudits: (propertyId: string) => `/properties/${propertyId}/night-audits`,
    nightAudit: (propertyId: string, runId: string) =>
      `/properties/${propertyId}/night-audits/${runId}`,
    nightAuditRecover: (propertyId: string, runId: string) =>
      `/properties/${propertyId}/night-audits/${runId}/recover`,
  },
  organization: {
    organizationOverview: () => "/organization/overview",
    organizationReportsPerformance: () => "/organization/reports/performance",
    availability: () => "/availability",
    auditLogs: () => "/audit-logs",
    users: () => "/users",
    roles: () => "/roles",
    userRoleAssignments: (userId: string) => `/users/${userId}/role-assignments`,
    userRoleAssignment: (userId: string, assignmentId: string) =>
      `/users/${userId}/role-assignments/${assignmentId}`,
    userAction: (userId: string, action: string) => `/users/${userId}/${action}`,
    userPasswordReset: (userId: string) => `/users/${userId}/password-reset`,
    properties: () => "/properties",
    setupCopyFrom: (targetId: string, sourceId: string) =>
      `/properties/${targetId}/setup/copy-from/${sourceId}`,
  },
  properties: {
    businessDate: (propertyId: string) => `/properties/${propertyId}/business-date`,
  },
  rates: {
    ratesOptions: (propertyId: string) => `/properties/${propertyId}/rates/options`,
    ratePlans: (propertyId: string) => `/properties/${propertyId}/rate-plans`,
    ratePlan: (propertyId: string, ratePlanId: string) =>
      `/properties/${propertyId}/rate-plans/${ratePlanId}`,
    ratesCalendar: (propertyId: string) => `/properties/${propertyId}/rates/calendar`,
    restrictions: (propertyId: string) => `/properties/${propertyId}/restrictions`,
    packages: (propertyId: string) => `/properties/${propertyId}/packages`,
    package: (propertyId: string, packageId: string) =>
      `/properties/${propertyId}/packages/${packageId}`,
    ratePlanSeasons: (propertyId: string, ratePlanId: string) =>
      `/properties/${propertyId}/rate-plans/${ratePlanId}/seasons`,
    ratePlanSeason: (propertyId: string, ratePlanId: string, seasonId: string) =>
      `/properties/${propertyId}/rate-plans/${ratePlanId}/seasons/${seasonId}`,
    ratePlanPackages: (propertyId: string, ratePlanId: string) =>
      `/properties/${propertyId}/rate-plans/${ratePlanId}/packages`,
    ratePlanAccounts: (propertyId: string, ratePlanId: string) =>
      `/properties/${propertyId}/rate-plans/${ratePlanId}/accounts`,
  },
  reports: {
    reportExport: (propertyId: string, reportKey: string) =>
      `/properties/${propertyId}/reports/${reportKey}/export`,
    reports: (propertyId: string) => `/properties/${propertyId}/reports`,
    report: (propertyId: string, reportKey: string) =>
      `/properties/${propertyId}/reports/${reportKey}`,
    dashboard: (propertyId: string) => `/properties/${propertyId}/dashboard`,
  },
  reservations: {
    availability: (propertyId: string) => `/properties/${propertyId}/availability`,
    bookingOptions: (propertyId: string) => `/properties/${propertyId}/booking-options`,
    roomsAvailable: (propertyId: string) => `/properties/${propertyId}/rooms/available`,
    reservations: (propertyId: string) => `/properties/${propertyId}/reservations`,
    reservation: (propertyId: string, reservationId: string) =>
      `/properties/${propertyId}/reservations/${reservationId}`,
    reservationRoom: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}`,
    reservationRoomConfirm: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/confirm`,
    reservationRoomCancel: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/cancel`,
    reservationRoomNoShow: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/no-show`,
    reservationRoomReinstate: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/reinstate`,
    reservationRoomReinstateNoShow: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/reinstate-no-show`,
    reservationCompany: (propertyId: string, reservationId: string) =>
      `/properties/${propertyId}/reservations/${reservationId}/company`,
    reservationRoomAssignRoom: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/assign-room`,
    reservationRoomChargeEstimate: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/charge-estimate`,
    reservationRoomPackages: (propertyId: string, reservationRoomId: string) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/packages`,
    reservationRoomPackage: (
      propertyId: string,
      reservationRoomId: string,
      reservationPackageId: string,
    ) =>
      `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/packages/${reservationPackageId}`,
  },
  rooms: {
    roomsPicker: (propertyId: string) => `/properties/${propertyId}/rooms/picker`,
    roomsBoard: (propertyId: string) => `/properties/${propertyId}/rooms/board`,
    roomsBoardOptions: (propertyId: string) => `/properties/${propertyId}/rooms/board-options`,
    room: (propertyId: string, roomId: string) => `/properties/${propertyId}/rooms/${roomId}`,
    roomBlocks: (propertyId: string, roomId: string) =>
      `/properties/${propertyId}/rooms/${roomId}/blocks`,
    roomBlockRelease: (propertyId: string, blockId: string) =>
      `/properties/${propertyId}/room-blocks/${blockId}/release`,
    roomInspect: (propertyId: string, roomId: string) =>
      `/properties/${propertyId}/rooms/${roomId}/inspect`,
    roomAction: (propertyId: string, roomId: string, action: string) =>
      `/properties/${propertyId}/rooms/${roomId}/${action}`,
  },
  search: {
    propertySearch: (propertyId: string) => `/properties/${propertyId}/search`,
    organizationSearch: () => "/search",
  },
  auth: {
    refresh: () => "/auth/refresh",
    me: () => "/me",
    authLogin: () => "/auth/login",
    authLogout: () => "/auth/logout",
    authSessions: () => "/auth/sessions",
    authSession: (sessionId: string) => `/auth/sessions/${sessionId}`,
    authPassword: () => "/auth/password",
    meAvatar: () => "/me/avatar",
    authPasswordReset: () => "/auth/password/reset",
  },
  setup: {
    setup: (propertyId: string) => `/properties/${propertyId}/setup`,
    setupRoomTypes: (propertyId: string) => `/properties/${propertyId}/setup/room-types`,
    setupRoomType: (propertyId: string, roomTypeId: string) =>
      `/properties/${propertyId}/setup/room-types/${roomTypeId}`,
    setupFloors: (propertyId: string) => `/properties/${propertyId}/setup/floors`,
    setupFloor: (propertyId: string, floorId: string) =>
      `/properties/${propertyId}/setup/floors/${floorId}`,
    setupRooms: (propertyId: string) => `/properties/${propertyId}/setup/rooms`,
    setupRoom: (propertyId: string, roomId: string) =>
      `/properties/${propertyId}/setup/rooms/${roomId}`,
    setupTaxes: (propertyId: string) => `/properties/${propertyId}/setup/taxes`,
    setupTax: (propertyId: string, taxRuleId: string) =>
      `/properties/${propertyId}/setup/taxes/${taxRuleId}`,
    configuration: (propertyId: string) => `/properties/${propertyId}/configuration`,
    businessDateInitialize: (propertyId: string) =>
      `/properties/${propertyId}/business-date/initialize`,
  },
  realtime: {
    propertyEvents: (propertyId: string) => `/properties/${propertyId}/events`,
  },
} as const;

/** Paths relative to the API origin (outside the versioned `/api/v1` base). */
export const API_ORIGIN_PATHS = {
  /** Liveness probe: no database, no session. */
  healthLive: "/api/health/live",
} as const;
