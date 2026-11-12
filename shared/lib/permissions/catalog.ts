/**
 * Permission catalog: the single source of truth for `resource:action` keys.
 * Isomorphic (used by server authorization, the seed and UI gating).
 * The UI only hides what the server would refuse; the server always decides.
 * See docs/RBAC.md.
 */

interface PermissionDefinition {
  description: string;
  /** High-risk actions require a reason code/comment and write a HIGH audit record. */
  highRisk?: boolean;
}

export const PERMISSIONS = {
  // Dashboard & search
  "dashboard:read": { description: "View operational dashboards" },
  "search:global": { description: "Use global search (guests, reservations, rooms, profiles)" },

  // Reservations
  "reservations:read": { description: "View reservations" },
  "reservations:create": { description: "Create reservations" },
  "reservations:update": { description: "Modify reservations (dates, party, room type, notes)" },
  "reservations:cancel": { description: "Cancel reservations", highRisk: true },
  "reservations:reinstate": {
    description: "Reinstate cancelled or no-show reservations",
    highRisk: true,
  },
  "reservations:no_show": { description: "Mark reservations as no-show manually", highRisk: true },
  "reservations:override_rate": {
    description: "Override the calculated rate or apply discounts",
    highRisk: true,
  },
  "reservations:override_availability": {
    description: "Book beyond availability, restrictions or closed rates (overbook)",
    highRisk: true,
  },
  "reservations:waitlist": { description: "Manage the waitlist" },

  // Availability & rates
  "availability:read": { description: "View availability and inventory" },
  "availability:manage": {
    description: "Change restrictions, sell limits and overbooking",
    highRisk: true,
  },
  "rates:read": { description: "View rate plans and prices" },
  "rates:manage": {
    description: "Create and change rate plans, seasons and prices",
    highRisk: true,
  },
  "packages:manage": { description: "Configure packages and components" },

  // Front desk
  "frontdesk:read": { description: "View arrivals, departures and in-house lists" },
  "frontdesk:checkin": { description: "Check guests in (including walk-ins)" },
  "frontdesk:checkout": { description: "Check guests out" },
  "frontdesk:reverse_checkin": { description: "Reverse a same-day check-in", highRisk: true },
  "frontdesk:reinstate_checkout": { description: "Reinstate a same-day check-out", highRisk: true },
  "frontdesk:messages": { description: "Manage guest messages, traces and wake-up calls" },

  // Rooms
  "rooms:read": { description: "View rooms and the room rack" },
  "rooms:assign": { description: "Assign, unassign and move rooms" },
  "rooms:upgrade": {
    description: "Assign a room of a different type without charge change",
    highRisk: true,
  },
  "rooms:update_status": { description: "Change housekeeping / front office room status" },
  "rooms:out_of_order": {
    description: "Place rooms out of order or out of service",
    highRisk: true,
  },
  "rooms:hold": { description: "Place and release room holds" },
  "rooms:override_hold": { description: "Assign a room held by another user" },

  // Guests & profiles
  "guests:read": { description: "View guest profiles" },
  "guests:create": { description: "Create guest profiles" },
  "guests:update": { description: "Edit guest profiles" },
  "guests:read_sensitive": {
    description: "View identity documents and restricted notes",
    highRisk: true,
  },
  "guests:merge": { description: "Merge duplicate profiles", highRisk: true },
  "guests:privacy": {
    description: "Export or anonymize personal data (privacy requests)",
    highRisk: true,
  },
  "accounts:read": { description: "View company, travel agent and source profiles" },
  "accounts:manage": { description: "Create and edit company, travel agent and source profiles" },

  // Groups
  "groups:read": { description: "View groups and blocks" },
  "groups:manage": { description: "Create and change groups, blocks and allocations" },
  "groups:rooming_list": { description: "Import and manage rooming lists" },

  // Housekeeping & maintenance
  "housekeeping:read": { description: "View the housekeeping board and task sheets" },
  "housekeeping:update": { description: "Update task progress and room cleaning status" },
  "housekeeping:assign": { description: "Generate task sheets and assign attendants" },
  "housekeeping:inspect": { description: "Inspect rooms and pass/fail cleaning" },
  "housekeeping:lost_found": { description: "Manage lost and found" },
  "maintenance:read": { description: "View maintenance requests" },
  "maintenance:create": { description: "Report maintenance requests" },
  "maintenance:update": { description: "Work on and resolve maintenance requests" },
  "maintenance:manage": { description: "Assign, prioritise and close maintenance requests" },

  // Billing, payments, cashiering
  "billing:read": { description: "View folios and postings" },
  "billing:post": { description: "Post charges to folios" },
  "billing:adjust": { description: "Adjust or reverse postings", highRisk: true },
  "billing:transfer": { description: "Transfer or split postings between folios" },
  "billing:routing": { description: "Manage routing instructions" },
  "billing:invoice": { description: "Issue invoices and folio documents" },
  "billing:credit_note": { description: "Issue credit notes against invoices", highRisk: true },
  "payments:read": { description: "View payments" },
  "payments:create": { description: "Take payments and deposits" },
  "payments:refund": { description: "Refund payments", highRisk: true },
  "payments:void": { description: "Void payments", highRisk: true },
  "cashier:operate": { description: "Open and close own cashier shift, cash drops and paid-outs" },
  "cashier:manage": { description: "Review and close any cashier shift", highRisk: true },

  // Night audit & business date
  "nightaudit:read": { description: "View night audit status and results" },
  "nightaudit:run": { description: "Run night audit and roll the business date", highRisk: true },

  // Reports
  "reports:read": { description: "Run operational reports" },
  "reports:financial": { description: "Run financial, cashier and revenue reports" },
  "reports:export": { description: "Export and schedule reports" },

  // Commercial
  "commissions:read": { description: "View commissions" },
  "commissions:manage": { description: "Approve, hold and pay commissions", highRisk: true },
  "loyalty:read": { description: "View loyalty memberships" },
  "loyalty:manage": { description: "Enrol members and adjust points", highRisk: true },

  // Administration
  "audit:read": { description: "View the audit log" },
  "users:read": { description: "View users" },
  "users:manage": { description: "Invite, disable users and assign roles", highRisk: true },
  "roles:manage": { description: "Create and edit roles and permissions", highRisk: true },
  "settings:read": { description: "View property configuration" },
  "settings:manage": {
    description: "Change property configuration and code tables",
    highRisk: true,
  },
  "properties:manage": { description: "Create and configure properties", highRisk: true },
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export function isHighRisk(permission: Permission): boolean {
  const definition: PermissionDefinition = PERMISSIONS[permission];
  return definition.highRisk === true;
}
