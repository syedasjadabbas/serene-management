import "server-only";
import { serverEnv } from "@/lib/env";
import type { PropertyContext, SessionContext } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { logServerError } from "@/lib/http/log";
import {
  canAccessProperty,
  hasPermission,
  hasPermissionAnywhere,
} from "@/lib/permissions/evaluate";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { matches } from "@/lib/utils/text-match";
import { accountsQuerySchema } from "@/modules/accounts/accounts.schema";
import { listAccounts } from "@/modules/accounts/accounts.service";
import type { AccountListItem } from "@/modules/accounts/accounts.types";
import { folioListQuerySchema } from "@/modules/billing/billing.schema";
import { listFolios } from "@/modules/billing/billing.service";
import { groupsQuerySchema } from "@/modules/groups/groups.schema";
import { listGroups } from "@/modules/groups/groups.service";
import { guestSearchQuerySchema } from "@/modules/guests/guests.schema";
import { searchGuests } from "@/modules/guests/guests.service";
import { requestsQuerySchema } from "@/modules/maintenance/maintenance.schema";
import { listRequests } from "@/modules/maintenance/maintenance.service";
import { listRatePlansForSearch } from "@/modules/rates/rate-plans.service";
import { listReservationsQuerySchema } from "@/modules/reservations/reservations.schema";
import { listReservations } from "@/modules/reservations/reservations.service";
import { searchRooms } from "@/modules/rooms/rooms.service";
import {
  SEARCH_LIMIT_PER_TYPE,
  SEARCH_LIMIT_TOTAL,
  SEARCH_RESULT_TYPES,
  type SearchScope,
  profileTargetCode,
} from "./search.policy";
import type {
  GlobalSearchResult,
  RoomView,
  SearchHitView,
  SearchResultGroup,
  SearchResultType,
} from "./search.types";

/**
 * Global search (docs/SCALABILITY.md §28): one authenticated request runs,
 * on the server, the searches the palette used to request one by one. Each
 * type is included only when the caller holds its read permission, and each
 * runs through the same service (scope, filters, order) as its own list
 * endpoint, limited to SEARCH_LIMIT_PER_TYPE. A type that fails is left out
 * (as the palette did) and logged; the others are still returned.
 */

export interface SearchOptions {
  /** Called with each type's duration (the route reports them in Server-Timing). */
  onTiming?: (type: SearchResultType, ms: number) => void;
}

interface SearchSource {
  type: SearchResultType;
  run: () => Promise<SearchHitView[]>;
}

const LIMIT = String(SEARCH_LIMIT_PER_TYPE);

/**
 * Start order: the slowest searches first (measured, SCALABILITY §28), so
 * with a bounded number in flight they are not queued behind quick ones.
 */
const START_ORDER: readonly SearchResultType[] = [
  "folios",
  "guests",
  "reservations",
  "maintenance",
  "groups",
  "companies",
  "rooms",
  "ratePlans",
];

const titleCase = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
// Intl formats decimal strings exactly: money never passes through a JS number.
const amount = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The current property's search: every type the user may read there. */
export function searchProperty(
  ctx: PropertyContext,
  q: string,
  options: SearchOptions = {},
): Promise<GlobalSearchResult> {
  const code = ctx.propertyCode;
  const can = (permission: Parameters<typeof hasPermission>[2]) =>
    hasPermission(ctx.access, ctx.propertyId, permission);
  const roomView: RoomView | null = can("housekeeping:read")
    ? "housekeeping"
    : can("frontdesk:read")
      ? "front-desk"
      : null;

  const sources: SearchSource[] = [];
  if (can("reservations:read")) {
    sources.push({ type: "reservations", run: () => reservations(ctx, q) });
  }
  // Organization profiles open in this property, so they are searched here
  // only when the user may read them here.
  if (can("guests:read")) sources.push({ type: "guests", run: () => guests(ctx, q, code) });
  if (can("rooms:read") && roomView) {
    sources.push({ type: "rooms", run: () => rooms(ctx, q, roomView) });
  }
  if (can("billing:read")) sources.push({ type: "folios", run: () => folios(ctx, q) });
  if (can("accounts:read")) {
    sources.push({ type: "companies", run: () => companies(ctx, q, code) });
  }
  if (can("groups:read")) sources.push({ type: "groups", run: () => groups(ctx, q) });
  if (can("maintenance:read")) {
    sources.push({ type: "maintenance", run: () => maintenance(ctx, q) });
  }
  if (can("rates:read")) sources.push({ type: "ratePlans", run: () => ratePlans(ctx, q) });
  return runSources(ctx, q, sources, options);
}

/**
 * The organization workspace's search: guest and company profiles. Each type
 * opens in the lowest-coded accessible property where the user holds its
 * read permission; without one its results are returned unavailable
 * (`propertyCode` null), never linked.
 */
export function searchOrganization(
  ctx: SessionContext,
  properties: readonly { id: string; code: string }[],
  q: string,
  options: SearchOptions = {},
): Promise<GlobalSearchResult> {
  const scope: SearchScope = {
    user: { isSuperAdmin: ctx.access.isSuperAdmin },
    properties: properties
      .filter((p) => canAccessProperty(ctx.access, p.id))
      .map((p) => ({ code: p.code, permissions: ctx.access.byProperty[p.id] ?? [] })),
  };
  const sources: SearchSource[] = [];
  if (hasPermissionAnywhere(ctx.access, "guests:read")) {
    const code = profileTargetCode(scope, "guests:read");
    sources.push({ type: "guests", run: () => guests(ctx, q, code) });
  }
  if (hasPermissionAnywhere(ctx.access, "accounts:read")) {
    const code = profileTargetCode(scope, "accounts:read");
    sources.push({ type: "companies", run: () => companies(ctx, q, code) });
  }
  return runSources(ctx, q, sources, options);
}

async function runSources(
  ctx: SessionContext,
  q: string,
  sources: SearchSource[],
  options: SearchOptions,
): Promise<GlobalSearchResult> {
  const ordered = [...sources].sort(
    (a, b) => START_ORDER.indexOf(a.type) - START_ORDER.indexOf(b.type),
  );
  const settled = await mapWithConcurrency(
    ordered,
    serverEnv().SEARCH_CONCURRENCY,
    async (source) => {
      const started = performance.now();
      try {
        return { type: source.type, hits: await source.run() };
      } catch (error) {
        // An expected refusal (permission, validation) just omits the type.
        if (!(error instanceof AppError)) {
          logServerError(`global search: ${source.type}`, error, ctx.requestId);
        }
        return { type: source.type, hits: [] as SearchHitView[] };
      } finally {
        options.onTiming?.(source.type, performance.now() - started);
      }
    },
  );
  const byType = new Map(settled.map((group) => [group.type, group.hits]));
  const groups: SearchResultGroup[] = [];
  let total = 0;
  for (const type of SEARCH_RESULT_TYPES) {
    const hits = (byType.get(type) ?? []).slice(
      0,
      Math.min(SEARCH_LIMIT_PER_TYPE, SEARCH_LIMIT_TOTAL - total),
    );
    if (hits.length === 0) continue;
    total += hits.length;
    groups.push({ type, hits });
  }
  return { query: q, groups };
}

/** Parses a type's own list query (as its endpoint would); null when it does not accept the text. */
function parseOr<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: Record<string, string>,
): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// --- Types -----------------------------------------------------------------------------

async function reservations(ctx: PropertyContext, q: string): Promise<SearchHitView[]> {
  const query = parseOr(listReservationsQuerySchema, { q, limit: LIMIT });
  if (!query) return [];
  const { items } = await listReservations(ctx, query);
  return items.map((r) => ({
    type: "reservations",
    id: r.reservationRoomId,
    title: `#${r.displayConfirmation}`,
    subtitle: `${r.guest.name} · ${shortDate(r.arrival)} → ${shortDate(r.departure)}`,
    meta: `${titleCase(r.bookingState)}${r.room ? ` · Room ${r.room.number}` : ""}`,
    vip: r.guest.isVip,
    propertyCode: ctx.propertyCode,
    targetId: r.reservationId,
  }));
}

async function guests(
  ctx: SessionContext,
  q: string,
  propertyCode: string | null,
): Promise<SearchHitView[]> {
  const query = parseOr(guestSearchQuerySchema, { q, limit: LIMIT });
  if (!query) return [];
  const { items } = await searchGuests(ctx, query);
  return items.map((g) => ({
    type: "guests",
    id: g.id,
    title: g.fullName,
    subtitle: [g.profileNumber, g.email ?? g.phone].filter(Boolean).join(" · "),
    meta: g.vip ? `VIP ${g.vip.code}` : null,
    vip: Boolean(g.vip),
    propertyCode,
    targetId: g.id,
  }));
}

async function rooms(
  ctx: PropertyContext,
  q: string,
  roomView: RoomView,
): Promise<SearchHitView[]> {
  const found = await searchRooms(ctx, q, SEARCH_LIMIT_PER_TYPE);
  return found.map((room) => ({
    type: "rooms",
    id: room.id,
    title: `Room ${room.number}`,
    subtitle: [room.roomTypeCode, room.floorName].filter(Boolean).join(" · "),
    meta: `${titleCase(room.frontOfficeStatus)} · ${titleCase(room.housekeepingStatus)}`,
    vip: false,
    propertyCode: ctx.propertyCode,
    targetId: room.id,
    roomView,
  }));
}

async function folios(ctx: PropertyContext, q: string): Promise<SearchHitView[]> {
  const query = parseOr(folioListQuerySchema, { q, limit: LIMIT, view: "all" });
  if (!query) return [];
  const { items } = await listFolios(ctx, query);
  return items.map((f) => ({
    type: "folios",
    id: f.reservationRoomId,
    title: f.guestName,
    subtitle: `Folio ${f.confirmation}${f.roomNumber ? ` · Room ${f.roomNumber}` : ""} · ${shortDate(f.arrival)} → ${shortDate(f.departure)}`,
    meta: `${f.currencyCode} ${amount.format(f.balance as unknown as number)}`,
    vip: false,
    propertyCode: ctx.propertyCode,
    targetId: f.reservationRoomId,
  }));
}

async function companies(
  ctx: SessionContext,
  q: string,
  propertyCode: string | null,
): Promise<SearchHitView[]> {
  const query = parseOr(accountsQuerySchema, { q, limit: LIMIT });
  if (!query) return [];
  const { items } = await listAccounts(ctx, query);
  return items.map((a: AccountListItem) => ({
    type: "companies",
    id: a.id,
    title: a.name,
    subtitle: [a.code, titleCase(a.type), [a.city, a.countryCode].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" · "),
    meta: a.status !== "ACTIVE" ? titleCase(a.status) : null,
    vip: false,
    propertyCode,
    targetId: a.id,
  }));
}

async function groups(ctx: PropertyContext, q: string): Promise<SearchHitView[]> {
  const query = parseOr(groupsQuerySchema, { q, limit: LIMIT });
  if (!query) return [];
  const { items } = await listGroups(ctx, query);
  return items.map((g) => ({
    type: "groups",
    id: g.id,
    title: g.name,
    subtitle: [
      g.code,
      g.firstNight && g.departure ? `${shortDate(g.firstNight)} → ${shortDate(g.departure)}` : null,
      g.account,
    ]
      .filter(Boolean)
      .join(" · "),
    meta: titleCase(g.status),
    vip: false,
    propertyCode: ctx.propertyCode,
    targetId: g.id,
  }));
}

async function maintenance(ctx: PropertyContext, q: string): Promise<SearchHitView[]> {
  const query = parseOr(requestsQuerySchema, { q, limit: LIMIT, view: "all" });
  if (!query) return [];
  const { items } = await listRequests(ctx, query);
  return items.map((m) => ({
    type: "maintenance",
    id: m.id,
    title: m.title,
    subtitle: `${m.requestNumber} · ${m.room ? `Room ${m.room.number}` : (m.location ?? "Public area")}`,
    meta: `${titleCase(m.priority)} · ${titleCase(m.status)}`,
    vip: false,
    propertyCode: ctx.propertyCode,
    targetId: m.id,
  }));
}

async function ratePlans(ctx: PropertyContext, q: string): Promise<SearchHitView[]> {
  const plans = await listRatePlansForSearch(ctx);
  return plans
    .filter((plan) => matches(q, plan.code, plan.name))
    .slice(0, SEARCH_LIMIT_PER_TYPE)
    .map((plan) => ({
      type: "ratePlans",
      id: plan.id,
      title: `${plan.code} · ${plan.name}`,
      subtitle: `${titleCase(plan.kind)} · ${plan.currencyCode}`,
      meta: plan.status === "ACTIVE" ? null : "Inactive",
      vip: false,
      propertyCode: ctx.propertyCode,
      targetId: plan.id,
    }));
}
