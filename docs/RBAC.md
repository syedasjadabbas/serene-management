# SERENE MANAGEMENT — RBAC

Code: [`lib/permissions/catalog.ts`](../lib/permissions/catalog.ts) (permission catalog), [`lib/permissions/roles.ts`](../lib/permissions/roles.ts) (role templates), [`lib/permissions/evaluate.ts`](../lib/permissions/evaluate.ts) (evaluation). Tables: `permissions`, `roles`, `role_permissions`, `user_role_assignments` ([DATABASE_DESIGN.md](./DATABASE_DESIGN.md) §4.2). Tests: `tests/unit/permissions.test.ts`.

---

## 1. Model

```text
User ──< UserRoleAssignment >── Role ──< RolePermission >── Permission("resource:action")
             │ scope = ORGANIZATION (all properties of the org)
             └ scope = PROPERTY + property_id (one property)
```

- **Permission**: `resource:action` key. The catalog is **code-owned** (a permission only exists if code checks it) and synchronised into the `permissions` table by the seed.
- **Role**: a named set of permissions. System templates (`organization_id IS NULL`) are cloned into each organization, where they can be edited; organizations can create their own roles (`roles:manage`).
- **Assignment**: a user gets roles organization-wide or per property. A user can hold different roles at different properties (e.g. Front Office Manager at property A, Read Only at property B).
- **Effective permissions** for (user, property) = union of the user's ORGANIZATION-scope roles and that property's PROPERTY-scope roles. No property grant and no org grant → no access to the property at all.
- **Super admin**: `users.is_super_admin` is a platform-operator flag (support staff), not a role; it bypasses permission checks, is never assignable from the UI, and every action is audited HIGH.
- **Deny by default**: absence of a permission = denied. There are no negative permissions.

## 2. Permission catalog

High-risk permissions (★) require a reason and create HIGH audit records.

| Resource       | Actions                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `dashboard`    | `read`                                                                                                                  |
| `search`       | `global`                                                                                                                |
| `reservations` | `read`, `create`, `update`, `cancel`★, `reinstate`★, `no_show`★, `override_rate`★, `override_availability`★, `waitlist` |
| `availability` | `read`, `manage`★                                                                                                       |
| `rates`        | `read`, `manage`★                                                                                                       |
| `packages`     | `manage`                                                                                                                |
| `frontdesk`    | `read`, `checkin`, `checkout`, `reverse_checkin`★, `reinstate_checkout`★, `messages`                                    |
| `rooms`        | `read`, `assign`, `upgrade`★, `update_status`, `out_of_order`★, `hold`, `override_hold`                                 |
| `guests`       | `read`, `create`, `update`, `read_sensitive`★, `merge`★, `privacy`★                                                     |
| `accounts`     | `read`, `manage`                                                                                                        |
| `groups`       | `read`, `manage`, `rooming_list`                                                                                        |
| `housekeeping` | `read`, `update`, `assign`, `inspect`, `lost_found`                                                                     |
| `maintenance`  | `read`, `create`, `update`, `manage`                                                                                    |
| `billing`      | `read`, `post`, `adjust`★, `transfer`, `routing`, `invoice`, `credit_note`★                                             |
| `payments`     | `read`, `create`, `refund`★, `void`★                                                                                    |
| `cashier`      | `operate`, `manage`★                                                                                                    |
| `nightaudit`   | `read`, `run`★                                                                                                          |
| `reports`      | `read`, `financial`, `export`                                                                                           |
| `commissions`  | `read`, `manage`★                                                                                                       |
| `loyalty`      | `read`, `manage`★                                                                                                       |
| `audit`        | `read`                                                                                                                  |
| `users`        | `read`, `manage`★                                                                                                       |
| `roles`        | `manage`★                                                                                                               |
| `settings`     | `read`, `manage`★                                                                                                       |
| `properties`   | `manage`★                                                                                                               |

78 permissions in total. Adding a permission = add it to the catalog, check it in a route/service, add it to the relevant templates, run the seed; the unit test rejects malformed keys and unknown keys in templates.

Payment creation is not flagged high-risk as a permission (it is routine front-desk work), but every payment, refund and void is still written as a **HIGH** audit record per Guide §29.

## 3. Role templates

| Role                 | Intent                               | Notable grants                                                                                                                                                           |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Super Admin          | platform flag, not a role            | everything, all organizations                                                                                                                                            |
| Organization Admin   | owner/IT of the hotel company        | all permissions                                                                                                                                                          |
| General Manager      | runs a property                      | all except `properties:manage`, `roles:manage`                                                                                                                           |
| Front Office Manager | supervises front desk & reservations | front desk + reservations incl. overrides, reinstatements, adjustments, refunds, voids, night audit, cashier management, sensitive guest data, merges, groups, audit log |
| Front Desk Agent     | check-in/out, in-house service       | reservations create/update/cancel, check-in/out, messages, room assign/status, posting, transfers, invoices, own cashier, payments                                       |
| Reservations Agent   | sales & bookings                     | reservations create/update/cancel/waitlist, holds, profiles create/update, payments (deposits)                                                                           |
| Housekeeping Manager | runs housekeeping                    | task sheets & assignment, inspection, room status, OOO/OOS, lost & found, reports                                                                                        |
| Housekeeper          | attendant (tablet)                   | own tasks, room cleaning status, lost & found, report maintenance                                                                                                        |
| Maintenance Manager  | runs engineering                     | assign/close requests, OOO/OOS, reports                                                                                                                                  |
| Maintenance Staff    | technician                           | read/update requests, report new ones                                                                                                                                    |
| Cashier              | cashiering desk                      | post, transfer, invoice, payments, own cashier shift                                                                                                                     |
| Accountant           | back-office finance                  | read everything financial, adjust, credit notes, refunds, cashier management, commissions, financial reports & exports                                                   |
| Auditor              | internal/external audit              | read-only + financial reports + audit log                                                                                                                                |
| Read Only            | observers                            | read permissions only                                                                                                                                                    |

Exact lists are in `lib/permissions/roles.ts` (the test suite asserts that line-staff roles hold no high-risk permission).

## 4. Enforcement points

| Layer                                   | Responsibility                                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy.ts`                              | Optimistic: authenticated or redirect to login. **No authorization decisions.**                                                                                                                                 |
| `(workspace)/[propertyCode]/layout.tsx` | Property access check for rendering; permission-denied state.                                                                                                                                                   |
| UI (`usePermissions`)                   | Hide/disable actions the user cannot perform (convenience only).                                                                                                                                                |
| `defineRoute` (route handler)           | **Authoritative**: authenticate, `canAccessProperty`, `hasPermission(access, propertyId, permission)`, reason required for high-risk.                                                                           |
| Services                                | Data-dependent rules: ownership (own cashier shift, own housekeeping tasks), approval thresholds (refund > limit needs a second approver), field-level sensitivity (ID documents need `guests:read_sensitive`). |
| Database                                | Property isolation via composite FKs; append-only audit.                                                                                                                                                        |

The access profile is loaded per request from `user_role_assignments ⨝ role_permissions` (one indexed query) into:

```ts
interface AccessProfile {
  userId: string;
  organizationId: string;
  isSuperAdmin: boolean;
  byProperty: Record<propertyId, Permission[]>; // org grants merged into every property
}
```

`GET /api/v1/me` returns the same structure (permission keys per property) so the UI can gate actions without extra calls. Changes to roles/assignments take effect on the next request (no permissions inside the JWT, so no stale grants).

## 5. Property-level permissions

- A property appears in a user's switcher only if they have at least one grant covering it.
- Requests for a property without access return `404` for resources, `403` for property-level endpoints (e.g. `/properties/{id}/business-date`) — never data.
- Central profiles are organization data: a user with `guests:read` at any property can read guest profiles, but financial history of stays at properties where they have no `billing:read` is omitted.
- Cross-property reports include only properties where the user holds `reports:read` (and `reports:financial` for financial figures).

## 6. Administration and audit

- `users:manage`★: invite, disable, unlock, assign/revoke roles. A user cannot grant permissions they do not hold themselves (no privilege escalation), and cannot modify their own assignments.
- `roles:manage`★: edit organization roles. System templates are read-only; editing clones them.
- Every grant/revoke/role edit writes a HIGH audit record (`user.role_grant`, `role.permissions_update`) with before/after.
- Disabling a user revokes all sessions immediately.

## 7. Sensitive data visibility

| Data                                                        | Requirement                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| ID document numbers, scans                                  | `guests:read_sensitive` (view audited)                                 |
| Restricted guest notes (`visibility = MANAGEMENT/INTERNAL`) | `guests:read_sensitive`                                                |
| Card data                                                   | never available (tokens only; brand + last 4 shown to `payments:read`) |
| Folio contents                                              | `billing:read`                                                         |
| Rates on reservations (negotiated, comp)                    | `rates:read`; housekeeping roles do not see rates                      |
| Audit log                                                   | `audit:read`                                                           |

## Financial permissions (Phase 5, as implemented)

No permission was added; the Phase 0 catalog covers billing:

| Action                                          | Permission                                 | Risk                          |
| ----------------------------------------------- | ------------------------------------------ | ----------------------------- |
| View folios, ledger, balances                   | `billing:read`                             | —                             |
| Folio audit history                             | `billing:read` + `audit:read`              | —                             |
| Post a charge, post room charges, open window 1 | `billing:post`                             | STANDARD audit                |
| Open further windows                            | `billing:transfer`                         | STANDARD                      |
| Reverse / adjust a charge                       | `billing:adjust` ★ (reason required)       | HIGH                          |
| Take a payment, settle a zero window            | `payments:create`                          | payment HIGH, settle STANDARD |
| Void a same-day payment                         | `payments:void` ★ (reason required)        | HIGH                          |
| Refund a payment                                | `payments:refund` ★ (reason + reason code) | HIGH                          |
| Check out (with the zero-balance rule)          | `frontdesk:checkout`                       | STANDARD / HIGH (early)       |

The UI hides actions the user lacks (`actions` flags computed by the server); the routes enforce them regardless.

## Night audit, finance and reports (Phase 8, as implemented)

No permission was added; the Phase 0 catalog covers Phase 8:

| Action                                                    | Permission                                                                          | Risk            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| Readiness checklist, run history, run detail              | `nightaudit:read`                                                                   | —               |
| Run night audit, recover a stale run                      | `nightaudit:run` ★ (reason required)                                                | HIGH            |
| Automatic no-shows and fees inside the audit              | covered by `nightaudit:run` (SYSTEM actor in the audit rows)                        | HIGH            |
| Operations and rooms reports                              | `reports:read` (revenue columns hidden without `reports:financial`)                 | —               |
| Revenue, tax, payments, ledger and production reports     | `reports:financial`                                                                 | —               |
| CSV export                                                | `reports:export` + the report's own permission                                      | —               |
| Night-audit history report                                | `nightaudit:read`                                                                   | —               |
| Audit trail report                                        | `audit:read`                                                                        | —               |
| Dashboard                                                 | `dashboard:read` (revenue tiles with `reports:financial`)                           | —               |
| Extend an in-house stay                                   | `reservations:update` (beyond availability: `reservations:override_availability` ★) | STANDARD / HIGH |
| Reinstate a no-show                                       | `reservations:reinstate` ★                                                          | HIGH            |
| No-show fee code and reason in the property configuration | `settings:manage` ★                                                                 | HIGH            |

Role templates are unchanged: Front Office Manager, General Manager and Organization Admin run the audit; Accountant and Auditor read it with the financial reports and exports; front desk agents, housekeeping and maintenance managers see operational reports; cashiers see none.

## Rates, packages and groups (Phase 6, as implemented)

No permission was added; the Phase 0 catalog covers Phase 6:

| Action                                                           | Permission                                  | Risk            |
| ---------------------------------------------------------------- | ------------------------------------------- | --------------- |
| View rate plans, seasons, pricing calendar, packages             | `rates:read`                                | —               |
| Create / change rate plans, seasons, included packages           | `rates:manage` ★ (reason required)          | HIGH            |
| Create / change packages and components                          | `packages:manage`                           | STANDARD        |
| View restrictions                                                | `availability:read`                         | —               |
| Set / clear restrictions                                         | `availability:manage` ★ (reason required)   | HIGH            |
| View groups and blocks                                           | `groups:read`                               | —               |
| Create / change groups, blocks, allocation, status, release      | `groups:manage`                             | STANDARD / HIGH |
| Pick up a reservation from a block                               | `reservations:create` + `groups:read`       | STANDARD        |
| Overbook a block or pickup beyond house availability             | + `reservations:override_availability`      | HIGH            |
| Add / remove packages on a reservation; view its charge estimate | `reservations:update` / `reservations:read` | STANDARD / —    |

The UI hides what the user lacks (server-computed `actions` flags plus `can()`); every route enforces it regardless (verified with the read-only auditor: all Phase 6 mutations answer 403 with no state change).

## Guests, companies and loyalty (Phase 7, as implemented)

No permission was added. Profiles are organization data: a permission held at any property applies to the profile itself; property facts follow the permission at each property.

| Action                                             | Permission                                            | Risk                                       |
| -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Search / read guest profiles                       | `guests:read`                                         | —                                          |
| Date of birth, management / internal notes         | + `guests:read_sensitive` ★                           | —                                          |
| Create a profile                                   | `guests:create`                                       | STANDARD                                   |
| Edit a profile, preferences, notes                 | `guests:update` (DOB: + `guests:read_sensitive`)      | STANDARD / HIGH (restriction, status, DOB) |
| Guest history (reservations, stays)                | `reservations:read` at each property shown            | —                                          |
| Room totals and folio balances in history          | + `billing:read` at that property                     | —                                          |
| Read companies, a guest's companies                | `accounts:read`                                       | —                                          |
| Create / edit companies and relationships          | `accounts:manage` (+ `guests:read` for relationships) | STANDARD / HIGH (restriction, status)      |
| Read loyalty programs and a guest's memberships    | `loyalty:read`                                        | —                                          |
| Programs, tiers, enrollment, tier / status, points | `loyalty:manage` ★ (reason required)                  | HIGH                                       |
| Company on a reservation                           | `reservations:update` (+ `accounts:read` in the UI)   | STANDARD                                   |
| Negotiated companies of a rate plan                | `rates:manage` ★                                      | HIGH                                       |
| Profile audit trail on the profile page            | + `audit:read`                                        | —                                          |

Role templates: `loyalty:read` was added to the Read-only template (and so to Auditor) and to the Reservations agent template (and so to Front desk agent and Front office manager). Templates apply when an organization's roles are created; existing organizations keep their tailored roles until an administrator grants the permission.

## Multi-property operations (Phase 9, as implemented)

No permission was added (`integrations:manage` is deliberately not created). Organization endpoints only ever return properties the caller can access; a property id outside that scope in a query answers 403 instead of being dropped silently.

| Action                                                  | Permission                                                                                                  | Scope                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Organization workspace                                  | organization grants or more than one property (UI); each section re-checks on the server                    | —                            |
| Organization overview                                   | any accessible property; today's figures with `dashboard:read` there, open balance with `reports:financial` | per property                 |
| Organization performance report                         | `reports:read` per property; money with `reports:financial` there; CSV with `reports:export`                | per property                 |
| Central availability                                    | `search:global` and `availability:read` per property; "Book" hands off to `reservations:create` there       | per property                 |
| Organization audit trail                                | `audit:read` per property; organization-level rows with `audit:read` at organization scope                  | per property / organization  |
| Users list                                              | `users:read` or `users:manage`; assignments shown only for scopes where the caller holds one of them        | per scope                    |
| Create a property, copy setup (before go-live)          | `properties:manage` ★ (HIGH, reason)                                                                        | organization                 |
| Confirmation prefix (before go-live)                    | `settings:manage` ★ (HIGH, reason)                                                                          | property                     |
| Loyalty programs, tiers, membership tier/status, points | `loyalty:manage` ★                                                                                          | **organization** (D41)       |
| Loyalty enrollment                                      | `loyalty:manage` ★                                                                                          | any property                 |
| Preferences for every property                          | `guests:update`                                                                                             | **organization** (D41)       |
| Property preferences, profile editing                   | `guests:update`                                                                                             | that property / any property |

- **Organization scope** means a grant from an ORGANIZATION-scope role assignment (`hasOrganizationPermission`); a property grant of the same permission is not enough. Such grants also cover every property of the organization (§1).
- **History** (D41): property auditors see the rows written at properties where they hold `audit:read`; organization-level rows (guests, companies, loyalty, users, properties) need `audit:read` at organization scope.
- **Loyalty UI**: the guest profile shows _Enroll_ with a property grant and _Tier / status_ and _Points_ only with the organization grant; the preferences dialog shows preferences for every property read-only without the organization grant.
