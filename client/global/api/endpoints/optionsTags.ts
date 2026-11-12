/**
 * Cache tags for the option/picker queries (room picker, booking options,
 * housekeeping/maintenance/group/billing options, ...). Those queries keep
 * their data for five minutes, so every mutation that changes the reference
 * data behind them invalidates the matching tag instead of waiting it out.
 *
 * All use the `Options` tag type:
 * - `{ Options, <propertyId> }` — one property's setup, rate plans, business
 *   date and currency. Setup, rate-plan, configuration, go-live, night-audit
 *   and copy-setup mutations invalidate it for the property they changed.
 * - `{ Options, ORG_OPTIONS_ID }` — organization-level lists (guest
 *   preference codes, VIP levels).
 * - `{ Options, ASSIGNEE_OPTIONS_ID }` — assignee pickers (users holding a
 *   permission at a property); user and role-assignment mutations invalidate it.
 */

export const ORG_OPTIONS_ID = "ORG";
export const ASSIGNEE_OPTIONS_ID = "ASSIGNEES";

export const optionsTag = (propertyId: string) => ({ type: "Options" as const, id: propertyId });
export const orgOptionsTag = () => ({ type: "Options" as const, id: ORG_OPTIONS_ID });
export const assigneeOptionsTag = () => ({ type: "Options" as const, id: ASSIGNEE_OPTIONS_ID });
