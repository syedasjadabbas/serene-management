import { ALL_PERMISSIONS, type Permission } from "./catalog";

/**
 * System role templates. The seed copies these into each organization as
 * editable roles; organizations may then tailor them (docs/RBAC.md).
 * SUPER_ADMIN is not a role: it is the `users.is_super_admin` platform flag.
 */

const READ_ONLY: Permission[] = [
  "dashboard:read",
  "search:global",
  "reservations:read",
  "availability:read",
  "rates:read",
  "frontdesk:read",
  "rooms:read",
  "guests:read",
  "accounts:read",
  "groups:read",
  "housekeeping:read",
  "maintenance:read",
  "billing:read",
  "payments:read",
  "nightaudit:read",
  "reports:read",
];

const RESERVATIONS_AGENT: Permission[] = [
  "dashboard:read",
  "search:global",
  "reservations:read",
  "reservations:create",
  "reservations:update",
  "reservations:cancel",
  "reservations:waitlist",
  "availability:read",
  "rates:read",
  "rooms:read",
  "rooms:hold",
  "guests:read",
  "guests:create",
  "guests:update",
  "accounts:read",
  "groups:read",
  "billing:read",
  "payments:read",
  "payments:create",
];

const FRONT_DESK_AGENT: Permission[] = [
  ...RESERVATIONS_AGENT,
  "frontdesk:read",
  "frontdesk:checkin",
  "frontdesk:checkout",
  "frontdesk:messages",
  "rooms:assign",
  "rooms:update_status",
  "housekeeping:read",
  "maintenance:read",
  "maintenance:create",
  "billing:post",
  "billing:transfer",
  "billing:invoice",
  "cashier:operate",
  "reports:read",
];

const FRONT_OFFICE_MANAGER: Permission[] = [
  ...FRONT_DESK_AGENT,
  "reservations:reinstate",
  "reservations:no_show",
  "reservations:override_rate",
  "reservations:override_availability",
  "frontdesk:reverse_checkin",
  "frontdesk:reinstate_checkout",
  "rooms:upgrade",
  "rooms:out_of_order",
  "rooms:override_hold",
  "guests:read_sensitive",
  "guests:merge",
  "accounts:manage",
  "groups:manage",
  "groups:rooming_list",
  "billing:adjust",
  "billing:routing",
  "payments:refund",
  "payments:void",
  "cashier:manage",
  "nightaudit:read",
  "nightaudit:run",
  "reports:financial",
  "reports:export",
  "audit:read",
];

const HOUSEKEEPER: Permission[] = [
  "rooms:read",
  "housekeeping:read",
  "housekeeping:update",
  "housekeeping:lost_found",
  "maintenance:create",
];

const HOUSEKEEPING_MANAGER: Permission[] = [
  ...HOUSEKEEPER,
  "dashboard:read",
  "frontdesk:read",
  "rooms:update_status",
  "rooms:out_of_order",
  "housekeeping:assign",
  "housekeeping:inspect",
  "maintenance:read",
  "reports:read",
];

const MAINTENANCE_STAFF: Permission[] = [
  "rooms:read",
  "maintenance:read",
  "maintenance:create",
  "maintenance:update",
];

const MAINTENANCE_MANAGER: Permission[] = [
  ...MAINTENANCE_STAFF,
  "dashboard:read",
  "maintenance:manage",
  "rooms:out_of_order",
  "housekeeping:read",
  "reports:read",
];

const CASHIER: Permission[] = [
  "search:global",
  "reservations:read",
  "frontdesk:read",
  "guests:read",
  "accounts:read",
  "billing:read",
  "billing:post",
  "billing:transfer",
  "billing:invoice",
  "payments:read",
  "payments:create",
  "cashier:operate",
];

const ACCOUNTANT: Permission[] = [
  ...READ_ONLY,
  "billing:adjust",
  "billing:credit_note",
  "payments:refund",
  "cashier:manage",
  "commissions:read",
  "commissions:manage",
  "reports:financial",
  "reports:export",
];

const AUDITOR: Permission[] = [
  ...READ_ONLY,
  "reports:financial",
  "reports:export",
  "audit:read",
  "commissions:read",
];

const GENERAL_MANAGER: Permission[] = ALL_PERMISSIONS.filter(
  (p) => !["properties:manage", "roles:manage"].includes(p),
);

export const ROLE_TEMPLATES = {
  ORGANIZATION_ADMIN: { name: "Organization Admin", permissions: ALL_PERMISSIONS },
  GENERAL_MANAGER: { name: "General Manager", permissions: GENERAL_MANAGER },
  FRONT_OFFICE_MANAGER: { name: "Front Office Manager", permissions: FRONT_OFFICE_MANAGER },
  FRONT_DESK_AGENT: { name: "Front Desk Agent", permissions: FRONT_DESK_AGENT },
  RESERVATIONS_AGENT: { name: "Reservations Agent", permissions: RESERVATIONS_AGENT },
  HOUSEKEEPING_MANAGER: { name: "Housekeeping Manager", permissions: HOUSEKEEPING_MANAGER },
  HOUSEKEEPER: { name: "Housekeeper", permissions: HOUSEKEEPER },
  MAINTENANCE_MANAGER: { name: "Maintenance Manager", permissions: MAINTENANCE_MANAGER },
  MAINTENANCE_STAFF: { name: "Maintenance Staff", permissions: MAINTENANCE_STAFF },
  CASHIER: { name: "Cashier", permissions: CASHIER },
  ACCOUNTANT: { name: "Accountant", permissions: ACCOUNTANT },
  AUDITOR: { name: "Auditor", permissions: AUDITOR },
  READ_ONLY: { name: "Read Only", permissions: READ_ONLY },
} as const satisfies Record<string, { name: string; permissions: readonly Permission[] }>;

export type RoleCode = keyof typeof ROLE_TEMPLATES;
